import { TesterApplicationStatus, TesterStatus } from '@prisma/client';
import {
  TesterApplicationRepository,
  type CreateTesterApplicationInput,
  type UpdateTesterApplicationInput,
} from '../repositories/tester-application.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/response.js';

export class TesterApplicationService {
  static async submitApplication(
    userId: string,
    input: Omit<CreateTesterApplicationInput, 'userId'>,
  ) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.testerStatus === TesterStatus.VERIFIED) {
      throw new ConflictError('Account is already a verified tester');
    }

    const activeApp = await TesterApplicationRepository.findActiveByUserId(userId);
    if (activeApp) {
      throw new ConflictError(
        `An active tester application is already in progress with status: ${activeApp.status}`,
      );
    }

    if (!input.fullName?.trim()) {
      throw new ValidationError('Full name is required');
    }
    if (!input.email?.trim()) {
      throw new ValidationError('Email is required');
    }

    const application = await TesterApplicationRepository.create({
      ...input,
      userId,
    });

    await TesterApplicationRepository.recordAuditLog({
      actorId: userId,
      targetUserId: userId,
      applicationId: application.id,
      action: 'SUBMIT',
      metadata: { status: application.status },
    });

    return application;
  }

  static async getMyApplication(userId: string) {
    const application = await TesterApplicationRepository.findLatestByUserId(userId);
    const user = await UserRepository.findById(userId);

    return {
      application,
      testerStatus: user?.testerStatus ?? TesterStatus.NOT_VERIFIED,
      isVerified: user?.testerStatus === TesterStatus.VERIFIED,
    };
  }

  static async updateMyApplication(userId: string, input: UpdateTesterApplicationInput) {
    const application = await TesterApplicationRepository.findActiveByUserId(userId);
    if (!application) {
      throw new NotFoundError('No active application found to update');
    }

    if (
      application.status !== TesterApplicationStatus.PENDING &&
      application.status !== TesterApplicationStatus.NEEDS_INFORMATION
    ) {
      throw new ConflictError(
        `Application cannot be updated when in ${application.status} status`,
      );
    }

    const nextStatus =
      application.status === TesterApplicationStatus.NEEDS_INFORMATION
        ? TesterApplicationStatus.UNDER_REVIEW
        : application.status;

    const updated = await TesterApplicationRepository.update(application.id, {
      fullName: input.fullName,
      email: input.email,
      phoneNumber: input.phoneNumber,
      avatarUrl: input.avatarUrl,
      city: input.city,
      state: input.state,
      country: input.country,
      bio: input.bio,
      experienceYears: input.experienceYears,
      preferredProductTypes: input.preferredProductTypes,
      languages: input.languages,
      credentials: input.credentials,
      sampleReviewUrl: input.sampleReviewUrl,
      portfolioUrls: input.portfolioUrls,
      applicantNotes: input.applicantNotes,
      status: nextStatus,
    });

    await TesterApplicationRepository.recordAuditLog({
      actorId: userId,
      targetUserId: userId,
      applicationId: application.id,
      action:
        application.status === TesterApplicationStatus.NEEDS_INFORMATION
          ? 'RESPOND_INFO'
          : 'UPDATE',
      metadata: { previousStatus: application.status, nextStatus },
    });

    return updated;
  }

  static async respondToInformationRequest(
    userId: string,
    notes: string,
    additionalUpdates?: Partial<UpdateTesterApplicationInput>,
  ) {
    if (!notes?.trim()) {
      throw new ValidationError('Response notes are required');
    }

    const application = await TesterApplicationRepository.findActiveByUserId(userId);
    if (!application) {
      throw new NotFoundError('No active application found');
    }

    if (application.status !== TesterApplicationStatus.NEEDS_INFORMATION) {
      throw new ConflictError(
        'Application is not currently awaiting additional information',
      );
    }

    const updated = await TesterApplicationRepository.update(application.id, {
      informationResponseNotes: notes.trim(),
      status: TesterApplicationStatus.UNDER_REVIEW,
      ...(additionalUpdates?.credentials
        ? { credentials: additionalUpdates.credentials }
        : {}),
      ...(additionalUpdates?.sampleReviewUrl
        ? { sampleReviewUrl: additionalUpdates.sampleReviewUrl }
        : {}),
      ...(additionalUpdates?.portfolioUrls
        ? { portfolioUrls: additionalUpdates.portfolioUrls }
        : {}),
      ...(additionalUpdates?.bio ? { bio: additionalUpdates.bio } : {}),
    });

    await TesterApplicationRepository.recordAuditLog({
      actorId: userId,
      targetUserId: userId,
      applicationId: application.id,
      action: 'RESPOND_INFO',
      reason: notes.trim(),
      metadata: {
        previousStatus: TesterApplicationStatus.NEEDS_INFORMATION,
        nextStatus: TesterApplicationStatus.UNDER_REVIEW,
      },
    });

    return updated;
  }

  static async getApplicationDetails(applicationId: string) {
    const application = await TesterApplicationRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('Tester application not found');
    }
    return application;
  }

  static async markUnderReview(adminId: string, applicationId: string) {
    const application = await TesterApplicationRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('Tester application not found');
    }

    if (adminId === application.userId) {
      throw new ForbiddenError('Cannot review your own tester application');
    }

    if (
      application.status !== TesterApplicationStatus.PENDING &&
      application.status !== TesterApplicationStatus.NEEDS_INFORMATION
    ) {
      throw new ConflictError(
        `Cannot mark application under review from status ${application.status}`,
      );
    }

    const updated = await TesterApplicationRepository.update(application.id, {
      status: TesterApplicationStatus.UNDER_REVIEW,
      reviewedBy: { connect: { id: adminId } },
    });

    await TesterApplicationRepository.recordAuditLog({
      actorId: adminId,
      targetUserId: application.userId,
      applicationId: application.id,
      action: 'REVIEW',
      metadata: {
        previousStatus: application.status,
        nextStatus: TesterApplicationStatus.UNDER_REVIEW,
      },
    });

    return updated;
  }

  static async requestInformation(adminId: string, applicationId: string, notes: string) {
    if (!notes?.trim()) {
      throw new ValidationError(
        'Notes describing the requested information are required',
      );
    }

    const application = await TesterApplicationRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('Tester application not found');
    }

    if (adminId === application.userId) {
      throw new ForbiddenError('Cannot request information on your own application');
    }

    if (
      application.status !== TesterApplicationStatus.PENDING &&
      application.status !== TesterApplicationStatus.UNDER_REVIEW
    ) {
      throw new ConflictError(
        `Cannot request information for application in status ${application.status}`,
      );
    }

    const updated = await TesterApplicationRepository.update(application.id, {
      status: TesterApplicationStatus.NEEDS_INFORMATION,
      informationRequestedNotes: notes.trim(),
      reviewedBy: { connect: { id: adminId } },
    });

    await TesterApplicationRepository.recordAuditLog({
      actorId: adminId,
      targetUserId: application.userId,
      applicationId: application.id,
      action: 'REQUEST_INFO',
      reason: notes.trim(),
      metadata: {
        previousStatus: application.status,
        nextStatus: TesterApplicationStatus.NEEDS_INFORMATION,
      },
    });

    return updated;
  }

  static async approveApplication(adminId: string, applicationId: string) {
    const application = await TesterApplicationRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('Tester application not found');
    }

    if (adminId === application.userId) {
      throw new ForbiddenError('Cannot approve your own tester application');
    }

    if (
      application.status !== TesterApplicationStatus.PENDING &&
      application.status !== TesterApplicationStatus.UNDER_REVIEW &&
      application.status !== TesterApplicationStatus.NEEDS_INFORMATION
    ) {
      throw new ConflictError(
        `Cannot approve application with status ${application.status}`,
      );
    }

    return TesterApplicationRepository.transaction(async (tx) => {
      const updated = await TesterApplicationRepository.update(
        application.id,
        {
          status: TesterApplicationStatus.APPROVED,
          reviewedBy: { connect: { id: adminId } },
          reviewedAt: new Date(),
        },
        tx,
      );

      await TesterApplicationRepository.updateUserTesterStatus(
        application.userId,
        TesterStatus.VERIFIED,
        application.bio,
        tx,
      );

      await TesterApplicationRepository.recordAuditLog(
        {
          actorId: adminId,
          targetUserId: application.userId,
          applicationId: application.id,
          action: 'APPROVE',
          metadata: {
            previousStatus: application.status,
            nextStatus: TesterApplicationStatus.APPROVED,
          },
        },
        tx,
      );

      return updated;
    });
  }

  static async rejectApplication(adminId: string, applicationId: string, reason: string) {
    if (!reason?.trim()) {
      throw new ValidationError('A rejection reason is required');
    }

    const application = await TesterApplicationRepository.findById(applicationId);
    if (!application) {
      throw new NotFoundError('Tester application not found');
    }

    if (adminId === application.userId) {
      throw new ForbiddenError('Cannot reject your own tester application');
    }

    if (
      application.status === TesterApplicationStatus.APPROVED ||
      application.status === TesterApplicationStatus.REJECTED
    ) {
      throw new ConflictError(
        `Cannot reject application that is already in status ${application.status}`,
      );
    }

    return TesterApplicationRepository.transaction(async (tx) => {
      const updated = await TesterApplicationRepository.update(
        application.id,
        {
          status: TesterApplicationStatus.REJECTED,
          rejectionReason: reason.trim(),
          reviewedBy: { connect: { id: adminId } },
          reviewedAt: new Date(),
        },
        tx,
      );

      await TesterApplicationRepository.updateUserTesterStatus(
        application.userId,
        TesterStatus.NOT_VERIFIED,
        undefined,
        tx,
      );

      await TesterApplicationRepository.recordAuditLog(
        {
          actorId: adminId,
          targetUserId: application.userId,
          applicationId: application.id,
          action: 'REJECT',
          reason: reason.trim(),
          metadata: {
            previousStatus: application.status,
            nextStatus: TesterApplicationStatus.REJECTED,
          },
        },
        tx,
      );

      return updated;
    });
  }

  static async suspendTester(adminId: string, targetUserId: string, reason: string) {
    if (!reason?.trim()) {
      throw new ValidationError('A suspension reason is required');
    }

    const user = await UserRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.testerStatus !== TesterStatus.VERIFIED) {
      throw new ConflictError(
        `Cannot suspend tester with current status: ${user.testerStatus}`,
      );
    }

    return TesterApplicationRepository.transaction(async (tx) => {
      const updated = await TesterApplicationRepository.updateUserTesterStatus(
        targetUserId,
        TesterStatus.SUSPENDED,
        undefined,
        tx,
      );

      await TesterApplicationRepository.recordAuditLog(
        {
          actorId: adminId,
          targetUserId,
          action: 'SUSPEND',
          reason: reason.trim(),
          metadata: {
            previousStatus: TesterStatus.VERIFIED,
            nextStatus: TesterStatus.SUSPENDED,
          },
        },
        tx,
      );

      return updated;
    });
  }

  static async revokeTester(adminId: string, targetUserId: string, reason: string) {
    if (!reason?.trim()) {
      throw new ValidationError('A revocation reason is required');
    }

    const user = await UserRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (
      user.testerStatus !== TesterStatus.VERIFIED &&
      user.testerStatus !== TesterStatus.SUSPENDED
    ) {
      throw new ConflictError(
        `Cannot revoke tester with current status: ${user.testerStatus}`,
      );
    }

    return TesterApplicationRepository.transaction(async (tx) => {
      const updated = await TesterApplicationRepository.updateUserTesterStatus(
        targetUserId,
        TesterStatus.REVOKED,
        undefined,
        tx,
      );

      await TesterApplicationRepository.recordAuditLog(
        {
          actorId: adminId,
          targetUserId,
          action: 'REVOKE',
          reason: reason.trim(),
          metadata: {
            previousStatus: user.testerStatus,
            nextStatus: TesterStatus.REVOKED,
          },
        },
        tx,
      );

      return updated;
    });
  }

  static async reinstateTester(adminId: string, targetUserId: string, notes?: string) {
    const user = await UserRepository.findById(targetUserId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (
      user.testerStatus !== TesterStatus.SUSPENDED &&
      user.testerStatus !== TesterStatus.REVOKED
    ) {
      throw new ConflictError(
        `Cannot reinstate tester with status: ${user.testerStatus}`,
      );
    }

    return TesterApplicationRepository.transaction(async (tx) => {
      const updated = await TesterApplicationRepository.updateUserTesterStatus(
        targetUserId,
        TesterStatus.VERIFIED,
        undefined,
        tx,
      );

      await TesterApplicationRepository.recordAuditLog(
        {
          actorId: adminId,
          targetUserId,
          action: 'REINSTATE',
          reason: notes?.trim() || 'Tester access restored by administrator',
          metadata: {
            previousStatus: user.testerStatus,
            nextStatus: TesterStatus.VERIFIED,
          },
        },
        tx,
      );

      return updated;
    });
  }
}
