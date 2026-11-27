import { DatingProfileStatus } from '@prisma/client';
import { DatingPhotoRepository } from '../repositories/dating-photo.repository.js';
import { DatingProfileRepository } from '../repositories/dating-profile.repository.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/response.js';
import { requireDatingProfile } from './dating-access.js';
import {
  DATING_CAPTION_MAX,
  DATING_MAX_PHOTOS,
  DATING_PHOTO_PRESIGN_LIMIT_PER_HOUR,
} from './dating-constants.js';
import { assertDatingTextAllowed } from './dating-policy.js';
import { assertHourlyPresignBudget } from './dating-profile.service.js';
import {
  assertDatingImageSize,
  assertDatingVideoDuration,
  assertDatingVideoSize,
  buildDatingPhotoObjectKey,
  DATING_IMAGE_MAX_BYTES,
  getStorageService,
  isAllowedDatingVideoContentType,
  isDatingVideoObjectKey,
  parseDatingPhotoObjectKey,
  signedDatingPhotoUrl,
} from './storage.service.js';
import { presentPhotos } from './dating-view.js';

async function ownPhoto(userId: string, photoId: string) {
  const profile = await requireDatingProfile(userId);
  const photo = await DatingPhotoRepository.findById(photoId);
  if (!photo || photo.profileId !== profile.id)
    throw new NotFoundError('Dating photo not found');
  return { profile, photo };
}

export class DatingPhotoService {
  static async presign(
    userId: string,
    contentType: string,
    fileSizeBytes: number,
    durationSeconds?: number,
  ) {
    const profile = await requireDatingProfile(userId);
    if (profile.photos.length >= DATING_MAX_PHOTOS) {
      throw new ValidationError('A dating profile cannot have more than 6 photos or videos');
    }
    if (isAllowedDatingVideoContentType(contentType)) {
      assertDatingVideoSize(fileSizeBytes);
      assertDatingVideoDuration(durationSeconds);
    } else {
      assertDatingImageSize(fileSizeBytes);
    }
    assertHourlyPresignBudget(`photo:${profile.id}`, DATING_PHOTO_PRESIGN_LIMIT_PER_HOUR);
    const objectKey = buildDatingPhotoObjectKey({ profileId: profile.id, contentType });
    return getStorageService().createPresignedUpload({
      objectKey,
      contentType,
      contentLength: fileSizeBytes,
    });
  }

  static async confirm(
    userId: string,
    input: {
      objectKey: string;
      caption?: string | null;
      byteSize: number;
      contentType: string;
      durationSeconds?: number;
    },
  ) {
    const profile = await requireDatingProfile(userId);
    if (profile.status === DatingProfileStatus.BANNED) {
      throw new ForbiddenError('Your 420 Dating profile is banned');
    }
    const parsed = parseDatingPhotoObjectKey(input.objectKey);
    if (!parsed || parsed.profileId !== profile.id) {
      throw new ValidationError('Photo key does not belong to this profile');
    }
    const video = isAllowedDatingVideoContentType(input.contentType);
    if (video) {
      assertDatingVideoSize(input.byteSize);
      assertDatingVideoDuration(input.durationSeconds);
    } else {
      assertDatingImageSize(input.byteSize);
    }
    const expected = buildDatingPhotoObjectKey({
      profileId: profile.id,
      contentType: input.contentType,
      objectId: parsed.objectId,
    });
    if (expected !== input.objectKey) {
      throw new ValidationError('contentType does not match the photo key');
    }
    const caption = input.caption?.trim() ? input.caption.trim() : null;
    if (caption && caption.length > DATING_CAPTION_MAX) {
      throw new ValidationError('caption is too long');
    }
    assertDatingTextAllowed(caption);
    const existing = await DatingPhotoRepository.findByObjectKey(input.objectKey);
    if (existing) throw new ValidationError('This photo was already confirmed');
    const current = await DatingPhotoRepository.listByProfile(profile.id);
    if (current.length >= DATING_MAX_PHOTOS) {
      throw new ValidationError('A dating profile cannot have more than 6 photos or videos');
    }
    const storage = getStorageService();
    const sizeCap = video ? 100 * 1024 * 1024 : DATING_IMAGE_MAX_BYTES;
    if (storage.inspectUploadedObject) {
      const metadata = await storage.inspectUploadedObject(input.objectKey);
      if (metadata && metadata.contentLength > sizeCap) {
        throw new ValidationError(
          video ? 'Dating videos must be 100 MB or smaller' : 'Dating images must be 10 MB or smaller',
        );
      }
      if (
        metadata?.contentType &&
        metadata.contentType.split(';')[0].trim() !== input.contentType
      ) {
        throw new ValidationError('Uploaded content type does not match the request');
      }
    }
    const hasPrimaryImage = current.some(
      (row) => row.isPrimary && !isDatingVideoObjectKey(row.objectKey),
    );
    const created = await DatingPhotoRepository.create({
      profileId: profile.id,
      objectKey: input.objectKey,
      sortOrder: current.length,
      isPrimary: !video && !hasPrimaryImage,
      caption,
    });
    const [view] = await presentPhotos([created], signedDatingPhotoUrl, true);
    return view;
  }

  static async reorder(userId: string, photoIds: string[]) {
    const profile = await requireDatingProfile(userId);
    const current = await DatingPhotoRepository.listByProfile(profile.id);
    const currentIds = new Set(current.map((photo) => photo.id));
    if (
      photoIds.length !== current.length ||
      new Set(photoIds).size !== photoIds.length
    ) {
      throw new ValidationError('photoIds must list every photo exactly once');
    }
    if (photoIds.some((id) => !currentIds.has(id))) {
      throw new ValidationError('photoIds includes a photo from another profile');
    }
    const rows = await DatingPhotoRepository.reorder(profile.id, photoIds);
    return presentPhotos(rows, signedDatingPhotoUrl, true);
  }

  static async makePrimary(userId: string, photoId: string) {
    const { profile, photo } = await ownPhoto(userId, photoId);
    if (isDatingVideoObjectKey(photo.objectKey)) {
      throw new ValidationError('Videos cannot be the profile photo');
    }
    const rows = await DatingPhotoRepository.setPrimary(profile.id, photoId);
    return presentPhotos(rows, signedDatingPhotoUrl, true);
  }

  static async remove(userId: string, photoId: string) {
    const { profile, photo } = await ownPhoto(userId, photoId);
    const removingImage = !isDatingVideoObjectKey(photo.objectKey);
    const imagesLeft = profile.photos.filter(
      (row) => row.id !== photo.id && !isDatingVideoObjectKey(row.objectKey),
    );
    if (profile.status === DatingProfileStatus.ACTIVE && removingImage && imagesLeft.length === 0) {
      throw new ValidationError('An active dating profile must keep at least one photo');
    }
    await DatingPhotoRepository.deleteById(photo.id);
    const remaining = (await DatingPhotoRepository.listByProfile(profile.id)).filter(
      (row) => row.id !== photo.id,
    );
    if (photo.isPrimary) {
      const nextImage = remaining.find((row) => !isDatingVideoObjectKey(row.objectKey));
      if (nextImage) await DatingPhotoRepository.setPrimary(profile.id, nextImage.id);
    }
    const fresh = await DatingProfileRepository.findById(profile.id);
    return presentPhotos(fresh?.photos ?? [], signedDatingPhotoUrl, true);
  }
}
