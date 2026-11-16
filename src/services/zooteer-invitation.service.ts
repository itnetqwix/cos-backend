import { AccountStatus, Role } from '@prisma/client';
import { HTTP_STATUS } from '../config/constants.js';
import { env } from '../config/env.js';
import { parsePaginationParams } from '../utils/pagination.js';
import { AppError, ForbiddenError } from '../utils/response.js';
import { EmailService } from './email/email.service.js';
import { renderZooteerInvitationEmail } from './email/email-template.js';
import { ZooteerAuditRepository } from '../repositories/zooteer-audit.repository.js';
import { ZooteerInvitationRecord, zooteerDb } from '../repositories/zooteer-db.js';
import { ZooteerInvitationRepository } from '../repositories/zooteer-invitation.repository.js';
import {
  AcceptZooteerInvitationInput,
  CreateZooteerInvitationInput,
  INVITATION_EXPIRY_DEFAULT_HOURS,
  ListZooteerInvitationsQuery,
} from '../schemas/zooteer-invitation.schema.js';
import { CREATOR_BLOCKED_MESSAGE } from './creator-account.service.js';
import { findZooteerInvitee, ZooteerInvitee } from './zooteer-invitee.js';
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationTokenHashesMatch,
} from './zooteer-invitation-token.js';

export interface ZooteerActor {
  id: string;
  role: Role;
}

export type InvitationState = 'active' | 'expired' | 'revoked' | 'accepted';

export interface InvitationView {
  id: string;
  roomId: string;
  inviteeUserId: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdById: string;
  createdAt: string;
  state: InvitationState;
}

let originOverride: string | undefined;

/** Pass undefined to read FRONTEND_URL again. Pass '' to simulate a missing origin. */
export function setZooteerLinkOrigin(next: string | undefined): void {
  originOverride = next;
}

function linkOrigin(): string {
  const raw = originOverride !== undefined ? originOverride : env.FRONTEND_URL;
  const value = raw.trim().replace(/\/+$/, '');
  if (!value || !/^https?:\/\//i.test(value)) {
    throw new AppError('FRONTEND_URL is not configured', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  return value;
}

function assertAdmin(actor: ZooteerActor): void {
  if (actor.role !== Role.ADMIN) {
    throw new ForbiddenError('Admin authorization is required');
  }
}

function assertEligible(user: ZooteerInvitee): void {
  if (user.accountStatus === AccountStatus.BLOCKED) {
    throw new ForbiddenError(CREATOR_BLOCKED_MESSAGE);
  }
  if (!user.emailVerifiedAt) {
    throw new ForbiddenError('Email verification is required');
  }
}

export function invitationState(
  row: ZooteerInvitationRecord,
  now = new Date(),
): InvitationState {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

function toView(row: ZooteerInvitationRecord, now = new Date()): InvitationView {
  return {
    id: row.id,
    roomId: row.roomId,
    inviteeUserId: row.inviteeUserId,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    state: invitationState(row, now),
  };
}

export class ZooteerInvitationService {
  static async create(
    actor: ZooteerActor,
    roomId: string,
    input: CreateZooteerInvitationInput,
  ) {
    assertAdmin(actor);
    const origin = linkOrigin();
    const invitee = await findZooteerInvitee(input.userId);
    if (!invitee) throw new AppError('User not found', HTTP_STATUS.NOT_FOUND);
    assertEligible(invitee);
    const now = new Date();
    const hours = input.expiresInHours ?? INVITATION_EXPIRY_DEFAULT_HOURS;
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const rawToken = generateInvitationToken();
    const created = await ZooteerInvitationRepository.createWithAudit({
      roomId,
      inviteeUserId: invitee.id,
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
      actorId: actor.id,
      now,
    });
    const link = `${origin}/zooteer/invitations/accept?token=${encodeURIComponent(rawToken)}`;
    const email = await deliverInvitation({
      to: invitee.email,
      name: invitee.name,
      roomId,
      roomName: created.roomName,
      inviteUrl: link,
      expiresAt,
      actorId: actor.id,
      invitationId: created.invitation.id,
    });
    return { invitation: toView(created.invitation, now), link, email };
  }

  static async list(
    actor: ZooteerActor,
    roomId: string,
    query: ListZooteerInvitationsQuery,
  ) {
    assertAdmin(actor);
    const room = await zooteerDb().zooteerRoom.findFirst({
      where: { id: roomId, deletedAt: null },
    });
    if (!room) throw new AppError('Room not found', HTTP_STATUS.NOT_FOUND);
    const { page, limit, skip } = parsePaginationParams(query);
    const [rows, totalCount] = await Promise.all([
      ZooteerInvitationRepository.listByRoom({ roomId, skip, take: limit }),
      ZooteerInvitationRepository.countByRoom(roomId),
    ]);
    return { items: rows.map((row) => toView(row)), totalCount, page, limit };
  }

  static async revoke(actor: ZooteerActor, roomId: string, invitationId: string) {
    assertAdmin(actor);
    const row = await ZooteerInvitationRepository.revoke({
      roomId,
      invitationId,
      actorId: actor.id,
      now: new Date(),
    });
    return toView(row);
  }

  static async accept(actor: ZooteerActor, input: AcceptZooteerInvitationInput) {
    const invitee = await findZooteerInvitee(actor.id);
    if (!invitee) throw new AppError('Invitation not found', HTTP_STATUS.NOT_FOUND);
    const tokenHash = hashInvitationToken(input.token);
    const invitation = await ZooteerInvitationRepository.findByTokenHash(tokenHash);
    if (
      !invitation ||
      !invitationTokenHashesMatch(invitation.tokenHash, tokenHash) ||
      invitation.inviteeUserId !== actor.id
    ) {
      throw new AppError('Invitation not found', HTTP_STATUS.NOT_FOUND);
    }
    assertEligible(invitee);
    return ZooteerInvitationRepository.accept({
      tokenHash,
      actorId: actor.id,
      now: new Date(),
      eligible: true,
    });
  }
}

async function deliverInvitation(input: {
  to: string;
  name: string;
  roomId: string;
  roomName: string;
  inviteUrl: string;
  expiresAt: Date;
  actorId: string;
  invitationId: string;
}): Promise<{ delivered: boolean; error: string | null }> {
  const rendered = renderZooteerInvitationEmail({
    name: input.name,
    roomName: input.roomName,
    inviteUrl: input.inviteUrl,
    expiresAt: input.expiresAt,
  });
  const result = await EmailService.getProvider().sendEmail({
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  try {
    await ZooteerAuditRepository.append(zooteerDb(), {
      roomId: input.roomId,
      actorUserId: input.actorId,
      action: 'INVITE_EMAIL',
      metadata: { invitationId: input.invitationId, delivered: result.delivered },
    });
  } catch {
    // The invitation row already committed. Delivery status is still returned to the admin.
  }
  return {
    delivered: result.delivered,
    error: result.delivered ? null : (result.error ?? 'Email was not sent'),
  };
}
