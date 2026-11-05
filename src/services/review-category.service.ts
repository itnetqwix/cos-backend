import { ReviewCategoryRepository } from '../repositories/review-category.repository.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/response.js';
import { CategoryProposalStatus } from '@prisma/client';

export function slugifyCategory(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export class ReviewCategoryService {
  static async listActive() {
    return ReviewCategoryRepository.listActive();
  }

  static async getById(id: string) {
    const category = await ReviewCategoryRepository.findById(id);
    if (!category) throw new NotFoundError('Category not found');
    return category;
  }

  static async listAdmin(options?: { includeInactive?: boolean; search?: string }) {
    return ReviewCategoryRepository.listAdmin(options);
  }

  static async proposeCategory(
    proposerId: string,
    input: { name: string; description: string },
  ) {
    const trimmedName = input.name.trim();
    const trimmedDesc = input.description.trim();

    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 50) {
      throw new ValidationError('Category name must be between 2 and 50 characters');
    }
    if (!trimmedDesc || trimmedDesc.length < 10 || trimmedDesc.length > 500) {
      throw new ValidationError(
        'Category description must be between 10 and 500 characters',
      );
    }

    const slugCandidate = slugifyCategory(trimmedName);
    if (!slugCandidate) {
      throw new ValidationError('Category name must contain alphanumeric characters');
    }

    // Check collision with existing categories
    const existingCat =
      (await ReviewCategoryRepository.findByName(trimmedName)) ||
      (await ReviewCategoryRepository.findBySlug(slugCandidate));
    if (existingCat) {
      throw new ConflictError(
        `A category named "${existingCat.name}" already exists (${existingCat.isActive ? 'active' : 'archived'})`,
      );
    }

    // Check collision with pending proposals
    const pending = await ReviewCategoryRepository.findPendingProposalByName(trimmedName);
    if (pending) {
      throw new ConflictError(
        `A proposal for "${pending.name}" is already pending review`,
      );
    }

    return ReviewCategoryRepository.createProposal({
      name: trimmedName,
      description: trimmedDesc,
      proposerId,
    });
  }

  static async listMyProposals(proposerId: string) {
    return ReviewCategoryRepository.listProposalsByProposer(proposerId);
  }

  static async listAdminProposals(status?: CategoryProposalStatus) {
    return ReviewCategoryRepository.listAdminProposals(status);
  }

  static async createAdminCategory(input: {
    name: string;
    description?: string | null;
    defaultWeight?: number;
    sortOrder?: number;
    isActive?: boolean;
  }) {
    const trimmedName = input.name.trim();
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 50) {
      throw new ValidationError('Category name must be between 2 and 50 characters');
    }
    if (
      input.defaultWeight !== undefined &&
      (input.defaultWeight <= 0 || !Number.isFinite(input.defaultWeight))
    ) {
      throw new ValidationError('Category weight must be a finite positive number');
    }

    const slug = slugifyCategory(trimmedName);
    const existing =
      (await ReviewCategoryRepository.findByName(trimmedName)) ||
      (await ReviewCategoryRepository.findBySlug(slug));
    if (existing) {
      throw new ConflictError(
        `A category with this name or slug already exists: ${existing.name}`,
      );
    }

    return ReviewCategoryRepository.create({
      name: trimmedName,
      slug,
      description: input.description,
      defaultWeight: input.defaultWeight ?? 1.0,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });
  }

  static async updateAdminCategory(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      defaultWeight?: number;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    const existing = await ReviewCategoryRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');

    if (
      input.defaultWeight !== undefined &&
      (input.defaultWeight <= 0 || !Number.isFinite(input.defaultWeight))
    ) {
      throw new ValidationError('Category weight must be a finite positive number');
    }

    // If deactivating, ensure at least one active category remains
    if (input.isActive === false && existing.isActive) {
      const activeList = await ReviewCategoryRepository.listActive();
      const remainingActive = activeList.filter((c) => c.id !== id);
      if (remainingActive.length === 0) {
        throw new ValidationError('Cannot deactivate the last active category');
      }
    }

    let slug: string | undefined;
    if (input.name && input.name.trim() !== existing.name) {
      const trimmed = input.name.trim();
      slug = slugifyCategory(trimmed);
      const collision =
        (await ReviewCategoryRepository.findByName(trimmed)) ||
        (await ReviewCategoryRepository.findBySlug(slug));
      if (collision && collision.id !== id) {
        throw new ConflictError(
          `Another category already uses the name or slug: ${collision.name}`,
        );
      }
    }

    return ReviewCategoryRepository.update(id, {
      ...input,
      ...(slug ? { slug } : {}),
    });
  }

  static async deactivateCategory(id: string) {
    const existing = await ReviewCategoryRepository.findById(id);
    if (!existing) throw new NotFoundError('Category not found');

    if (existing.isActive) {
      const activeList = await ReviewCategoryRepository.listActive();
      const remainingActive = activeList.filter((c) => c.id !== id);
      if (remainingActive.length === 0) {
        throw new ValidationError('Cannot deactivate the last active category');
      }
    }

    return ReviewCategoryRepository.deactivate(id);
  }

  static async approveProposal(
    proposalId: string,
    adminId: string,
    options?: {
      defaultWeight?: number;
      sortOrder?: number;
      reviewReason?: string;
    },
  ) {
    const proposal = await ReviewCategoryRepository.findProposalById(proposalId);
    if (!proposal) throw new NotFoundError('Category proposal not found');

    if (
      options?.defaultWeight !== undefined &&
      (options.defaultWeight <= 0 || !Number.isFinite(options.defaultWeight))
    ) {
      throw new ValidationError('Category weight must be a finite positive number');
    }

    let slug = slugifyCategory(proposal.name);
    const existingSlug = await ReviewCategoryRepository.findBySlug(slug);
    if (existingSlug) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    return ReviewCategoryRepository.approveProposal(proposalId, adminId, {
      slug,
      defaultWeight: options?.defaultWeight,
      sortOrder: options?.sortOrder,
      reviewReason: options?.reviewReason,
    });
  }

  static async rejectProposal(
    proposalId: string,
    adminId: string,
    rejectionReason: string,
  ) {
    if (!rejectionReason || !rejectionReason.trim()) {
      throw new ValidationError('Rejection reason is required');
    }

    return ReviewCategoryRepository.rejectProposal(proposalId, adminId, rejectionReason);
  }

  static async mergeCategories(sourceCategoryId: string, targetCategoryId: string) {
    if (sourceCategoryId === targetCategoryId) {
      throw new ValidationError('Source and target categories cannot be the same');
    }

    return ReviewCategoryRepository.merge(sourceCategoryId, targetCategoryId);
  }
}
