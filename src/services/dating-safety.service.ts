import {
  DatingNotificationType,
  DatingProfileStatus,
  DatingReportCategory,
  DatingReportStatus,
} from '@prisma/client';
import { DatingProfileRepository } from '../repositories/dating-profile.repository.js';
import { DatingMatchRepository } from '../repositories/dating-match.repository.js';
import {
  DatingNotificationRepository,
  DatingSafetyRepository,
} from '../repositories/dating-safety.repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/response.js';
import { requireDatingProfile } from './dating-access.js';
import { canonicalProfilePair } from './dating-match.service.js';
import {
  DATING_AUTO_BAN_SOLICITATIONS,
  DATING_AUTO_PAUSE_REPORTS,
  DATING_REPORT_LIMIT_PER_DAY,
} from './dating-constants.js';
import { datingPage, primaryPhoto } from './dating-view.js';
import { signedDatingPhotoUrl, signedDatingVerificationUrl } from './storage.service.js';
import { AppError } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function applyReportThresholds(reportedProfileId: string) {
  const since = new Date(Date.now() - DAY_MS);
  const recent = await DatingSafetyRepository.recentAgainst(reportedProfileId, since);
  const solicitations = recent.filter(
    (row) => row.reasonCategory === DatingReportCategory.SOLICITATION_OR_DRUG_DEALING,
  ).length;
  if (solicitations >= DATING_AUTO_BAN_SOLICITATIONS) {
    await DatingProfileRepository.updateStatus(
      reportedProfileId,
      DatingProfileStatus.BANNED,
    );
    return;
  }
  const distinct = new Set(recent.map((row) => row.reporterProfileId));
  if (distinct.size >= DATING_AUTO_PAUSE_REPORTS) {
    const profile = await DatingProfileRepository.findById(reportedProfileId);
    if (profile && profile.status === DatingProfileStatus.ACTIVE) {
      await DatingProfileRepository.updateStatus(
        reportedProfileId,
        DatingProfileStatus.PAUSED,
      );
    }
  }
}

export class DatingSafetyService {
  static async block(userId: string, blockedProfileId: string) {
    const profile = await requireDatingProfile(userId);
    if (profile.id === blockedProfileId)
      throw new ValidationError('You cannot block yourself');
    const target = await DatingProfileRepository.findById(blockedProfileId);
    if (!target) throw new NotFoundError('Dating profile not found');
    const existing = await DatingSafetyRepository.findBlock(profile.id, target.id);
    if (existing) throw new ConflictError('This profile is already blocked');
    const block = await DatingSafetyRepository.createBlock(profile.id, target.id);
    const pair = canonicalProfilePair(profile.id, target.id);
    await DatingMatchRepository.deactivatePair(
      pair.profileLowId,
      pair.profileHighId,
      profile.id,
    );
    return {
      id: block.id,
      blockedProfileId: target.id,
      createdAt: block.createdAt.toISOString(),
    };
  }

  static async unblock(userId: string, blockId: string) {
    const profile = await requireDatingProfile(userId);
    const block = await DatingSafetyRepository.findBlockById(blockId);
    if (!block || block.blockerProfileId !== profile.id)
      throw new NotFoundError('Block not found');
    await DatingSafetyRepository.deleteBlock(block.id);
    return { deleted: true };
  }

  static async listBlocks(userId: string) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    const rows = await DatingSafetyRepository.listBlocks(profile.id);
    return Promise.all(
      rows.map(async (row) => {
        const photo = primaryPhoto(row.blockedProfile.photos);
        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          blockedProfile: {
            id: row.blockedProfile.id,
            displayName: row.blockedProfile.displayName,
            primaryPhotoUrl: photo ? await signedDatingPhotoUrl(photo.objectKey) : null,
          },
        };
      }),
    );
  }

  static async report(
    userId: string,
    input: {
      profileId: string;
      reasonCategory: DatingReportCategory;
      details?: string | null;
      evidencePhotoKeys?: string[];
    },
  ) {
    const profile = await requireDatingProfile(userId);
    if (profile.id === input.profileId)
      throw new ValidationError('You cannot report yourself');
    const target = await DatingProfileRepository.findById(input.profileId);
    if (!target) throw new NotFoundError('Dating profile not found');
    const since = new Date(Date.now() - DAY_MS);
    const count = await DatingSafetyRepository.countReportsSince(profile.id, since);
    if (count >= DATING_REPORT_LIMIT_PER_DAY) {
      throw new AppError('Too many reports', HTTP_STATUS.TOO_MANY_REQUESTS);
    }
    const details = input.details?.trim() ? input.details.trim() : null;
    if (details && details.length > 2000)
      throw new ValidationError('details is too long');
    const created = await DatingSafetyRepository.createReport({
      reporterProfileId: profile.id,
      reportedProfileId: target.id,
      reasonCategory: input.reasonCategory,
      details,
      evidencePhotoKeys: input.evidencePhotoKeys ?? [],
    });
    await applyReportThresholds(target.id);
    return {
      id: created.id,
      status: created.status,
      reasonCategory: created.reasonCategory,
      createdAt: created.createdAt.toISOString(),
    };
  }

  static async listReports(
    status: DatingReportStatus | undefined,
    reasonCategory: DatingReportCategory | undefined,
    page: number,
    limit: number,
  ) {
    const [result, openSolicitationCount] = await Promise.all([
      DatingSafetyRepository.listReports({
        status,
        reasonCategory,
        skip: (page - 1) * limit,
        take: limit,
      }),
      DatingSafetyRepository.countOpenSolicitations(),
    ]);
    const pageResult = datingPage(
      result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        reasonCategory: row.reasonCategory,
        createdAt: row.createdAt.toISOString(),
        reporterProfileId: row.reporterProfileId,
        reportedProfileId: row.reportedProfileId,
        reportedDisplayName: row.reportedProfile.displayName,
      })),
      result.total,
      page,
      limit,
    );
    return { ...pageResult, openSolicitationCount };
  }

  static async getReport(id: string) {
    const report = await DatingSafetyRepository.findReport(id);
    if (!report) throw new NotFoundError('Report not found');
    return {
      id: report.id,
      status: report.status,
      reasonCategory: report.reasonCategory,
      details: report.details,
      resolutionNotes: report.resolutionNotes,
      createdAt: report.createdAt.toISOString(),
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      reporter: {
        id: report.reporterProfile.id,
        displayName: report.reporterProfile.displayName,
      },
      reviewedBy: report.reviewedBy
        ? { id: report.reviewedBy.id, name: report.reviewedBy.name }
        : null,
      reported: {
        id: report.reportedProfile.id,
        displayName: report.reportedProfile.displayName,
        status: report.reportedProfile.status,
        verificationStatus: report.reportedProfile.verificationStatus,
        verificationPhotoUrl: await signedDatingVerificationUrl(
          report.reportedProfile.verificationPhotoKey,
        ),
      },
      history: (
        await DatingSafetyRepository.historyForProfile(
          report.reportedProfileId,
          report.id,
        )
      ).map((row) => ({
        id: row.id,
        status: row.status,
        reasonCategory: row.reasonCategory,
        resolutionNotes: row.resolutionNotes,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
      })),
    };
  }

  static async resolveReport(
    reviewerUserId: string,
    reportId: string,
    input: {
      action?: 'DISMISS' | 'WARN' | 'SUSPEND' | 'BAN' | 'NOTE';
      status?: DatingReportStatus;
      resolutionNotes?: string | null;
    },
  ) {
    const report = await DatingSafetyRepository.findReport(reportId);
    if (!report) throw new NotFoundError('Report not found');
    if (!input.action && !input.status) {
      throw new ValidationError('Choose an action or a status');
    }
    let status = input.status ?? report.status;
    if (input.action === 'DISMISS') status = DatingReportStatus.DISMISSED;
    if (input.action === 'WARN' || input.action === 'BAN')
      status = DatingReportStatus.RESOLVED;
    if (input.action === 'SUSPEND') status = DatingReportStatus.RESOLVED;
    if (input.action === 'BAN') {
      await DatingProfileRepository.updateStatus(
        report.reportedProfileId,
        DatingProfileStatus.BANNED,
      );
    } else if (input.action === 'SUSPEND') {
      await DatingProfileRepository.updateStatus(
        report.reportedProfileId,
        DatingProfileStatus.PAUSED,
      );
    }
    const updated = await DatingSafetyRepository.updateReport(report.id, {
      status,
      resolutionNotes: input.resolutionNotes?.trim() || report.resolutionNotes,
      reviewedBy: { connect: { id: reviewerUserId } },
      reviewedAt: new Date(),
    });
    if (input.action === 'WARN' || input.action === 'SUSPEND' || input.action === 'BAN') {
      await DatingNotificationRepository.create({
        profileId: report.reportedProfileId,
        type: DatingNotificationType.SYSTEM_NOTICE,
        title: 'A moderator reviewed your dating profile',
        body: input.resolutionNotes ?? null,
        relatedEntityId: report.id,
      });
    }
    return { id: updated.id, status: updated.status };
  }

  static async banProfile(profileId: string) {
    const profile = await DatingProfileRepository.findById(profileId);
    if (!profile) throw new NotFoundError('Dating profile not found');
    const updated = await DatingProfileRepository.updateStatus(
      profile.id,
      DatingProfileStatus.BANNED,
    );
    return { id: updated.id, status: updated.status };
  }
}

export class DatingNotificationService {
  static async list(userId: string, page: number, limit: number) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    const result = await DatingNotificationRepository.list({
      profileId: profile.id,
      skip: (page - 1) * limit,
      take: limit,
    });
    return datingPage(
      result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        relatedEntityId: row.relatedEntityId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      result.total,
      page,
      limit,
    );
  }

  static async markRead(userId: string, notificationId: string) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    const result = await DatingNotificationRepository.markRead(
      notificationId,
      profile.id,
      new Date(),
    );
    if (result.count === 0) throw new NotFoundError('Notification not found');
    return { id: notificationId, read: true };
  }

  static async markAllRead(userId: string) {
    const profile = await requireDatingProfile(userId, { allowBanned: true });
    const result = await DatingNotificationRepository.markAllRead(profile.id, new Date());
    return { updatedCount: result.count };
  }
}
