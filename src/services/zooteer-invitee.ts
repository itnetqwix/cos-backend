import { AccountStatus, Role } from '@prisma/client';
import { prisma } from '../config/database.js';

export interface ZooteerInvitee {
  id: string;
  email: string;
  name: string;
  role: Role;
  accountStatus: AccountStatus;
  emailVerifiedAt: Date | null;
}

const inviteeSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  accountStatus: true,
  emailVerifiedAt: true,
} as const;

async function readInvitee(id: string): Promise<ZooteerInvitee | null> {
  return prisma.user.findUnique({ where: { id }, select: inviteeSelect });
}

let lookup: (id: string) => Promise<ZooteerInvitee | null> = readInvitee;

/** Test seam. Pass null to read Prisma again. */
export function setZooteerInviteeLookup(
  next: ((id: string) => Promise<ZooteerInvitee | null>) | null,
): void {
  lookup = next ?? readInvitee;
}

export function findZooteerInvitee(id: string): Promise<ZooteerInvitee | null> {
  return lookup(id);
}
