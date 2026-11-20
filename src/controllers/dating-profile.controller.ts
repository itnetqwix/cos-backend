import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import {
  datingIdParamSchema,
  datingOnboardingSchema,
  datingPageQuerySchema,
  datingPhotoConfirmSchema,
  datingPhotoPresignSchema,
  datingPhotoReorderSchema,
  datingPreferencesPatchSchema,
  datingProfilePatchSchema,
  datingStatusSchema,
  datingVerificationDecisionSchema,
} from '../schemas/dating.schema.js';
import { DatingPhotoService } from '../services/dating-photo.service.js';
import { DatingPreferencesService } from '../services/dating-preferences.service.js';
import { DatingProfileService } from '../services/dating-profile.service.js';
import { sendSuccess, UnauthorizedError } from '../utils/response.js';
import { z } from 'zod';

const verificationConfirmSchema = z
  .object({ objectKey: z.string().trim().min(1).max(300) })
  .strict();

export function datingActorId(request: FastifyRequest): string {
  const id = request.user?.id;
  if (!id) throw new UnauthorizedError('Unauthorized: Authentication required');
  return id;
}

function pageOf(query: ReturnType<typeof datingPageQuerySchema.parse>) {
  return { page: query.page ?? 1, limit: query.limit ?? 20 };
}

export class DatingProfileController {
  static async getMine(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingProfileService.getMine(datingActorId(request));
    return sendSuccess(reply, data, 'Dating profile retrieved', HTTP_STATUS.OK);
  }

  static async onboard(request: FastifyRequest, reply: FastifyReply) {
    const body = datingOnboardingSchema.parse(request.body ?? {});
    const data = await DatingProfileService.onboard(datingActorId(request), body);
    return sendSuccess(reply, data, 'Dating profile created', HTTP_STATUS.CREATED);
  }

  static async update(request: FastifyRequest, reply: FastifyReply) {
    const body = datingProfilePatchSchema.parse(request.body ?? {});
    const data = await DatingProfileService.update(datingActorId(request), body);
    return sendSuccess(reply, data, 'Dating profile updated', HTTP_STATUS.OK);
  }

  static async status(request: FastifyRequest, reply: FastifyReply) {
    const body = datingStatusSchema.parse(request.body ?? {});
    const data = await DatingProfileService.setStatus(
      datingActorId(request),
      body.status,
    );
    return sendSuccess(reply, data, 'Dating profile status updated', HTTP_STATUS.OK);
  }

  static async remove(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingProfileService.remove(datingActorId(request));
    return sendSuccess(reply, data, 'Dating profile deleted', HTTP_STATUS.OK);
  }

  static async getPublic(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingProfileService.getPublic(datingActorId(request), id);
    return sendSuccess(reply, data, 'Dating profile retrieved', HTTP_STATUS.OK);
  }

  static async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    const data = await DatingPreferencesService.get(datingActorId(request));
    return sendSuccess(reply, data, 'Preferences retrieved', HTTP_STATUS.OK);
  }

  static async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    const body = datingPreferencesPatchSchema.parse(request.body ?? {});
    const data = await DatingPreferencesService.update(datingActorId(request), body);
    return sendSuccess(reply, data, 'Preferences updated', HTTP_STATUS.OK);
  }

  static async presignVerification(request: FastifyRequest, reply: FastifyReply) {
    const body = datingPhotoPresignSchema.parse(request.body ?? {});
    const data = await DatingProfileService.presignVerification(
      datingActorId(request),
      body.contentType,
      body.fileSizeBytes,
    );
    return sendSuccess(reply, data, 'Upload URL created', HTTP_STATUS.OK);
  }

  static async confirmVerification(request: FastifyRequest, reply: FastifyReply) {
    const body = verificationConfirmSchema.parse(request.body ?? {});
    const data = await DatingProfileService.confirmVerification(
      datingActorId(request),
      body.objectKey,
    );
    return sendSuccess(reply, data, 'Verification submitted', HTTP_STATUS.OK);
  }

  static async reviewVerification(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const body = datingVerificationDecisionSchema.parse(request.body ?? {});
    const data = await DatingProfileService.reviewVerification(id, body.status);
    return sendSuccess(reply, data, 'Verification updated', HTTP_STATUS.OK);
  }
}

export class DatingPhotoController {
  static async presign(request: FastifyRequest, reply: FastifyReply) {
    const body = datingPhotoPresignSchema.parse(request.body ?? {});
    const data = await DatingPhotoService.presign(
      datingActorId(request),
      body.contentType,
      body.fileSizeBytes,
    );
    return sendSuccess(reply, data, 'Upload URL created', HTTP_STATUS.OK);
  }

  static async confirm(request: FastifyRequest, reply: FastifyReply) {
    const body = datingPhotoConfirmSchema.parse(request.body ?? {});
    const data = await DatingPhotoService.confirm(datingActorId(request), body);
    return sendSuccess(reply, data, 'Photo saved', HTTP_STATUS.CREATED);
  }

  static async reorder(request: FastifyRequest, reply: FastifyReply) {
    const body = datingPhotoReorderSchema.parse(request.body ?? {});
    const data = await DatingPhotoService.reorder(datingActorId(request), body.photoIds);
    return sendSuccess(reply, data, 'Photos reordered', HTTP_STATUS.OK);
  }

  static async primary(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingPhotoService.makePrimary(datingActorId(request), id);
    return sendSuccess(reply, data, 'Primary photo updated', HTTP_STATUS.OK);
  }

  static async remove(request: FastifyRequest, reply: FastifyReply) {
    const { id } = datingIdParamSchema.parse(request.params);
    const data = await DatingPhotoService.remove(datingActorId(request), id);
    return sendSuccess(reply, data, 'Photo deleted', HTTP_STATUS.OK);
  }
}

export { pageOf };
