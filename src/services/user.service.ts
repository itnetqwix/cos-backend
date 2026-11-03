import { UserRepository } from '../repositories/user.repository.js';
import { NotFoundError } from '../utils/response.js';
import { sanitizeUser } from '../utils/sanitize-user.js';
import { parsePaginationParams, buildPaginatedResult } from '../utils/pagination.js';
import { ListUsersQueryInput } from '../schemas/user.schema.js';

export class UserService {
  /**
   * Fetch user profile by ID.
   */
  static async getUserProfile(userId: string) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User profile not found');
    }
    return sanitizeUser(user);
  }

  /**
   * List users with pagination and optional search/role filters.
   */
  static async listUsers(query: ListUsersQueryInput) {
    const { page, limit, skip } = parsePaginationParams(query);

    const { users, totalCount } = await UserRepository.findMany({
      skip,
      limit,
      role: query.role,
      search: query.search,
    });

    return buildPaginatedResult(
      users.map((user) => sanitizeUser(user)),
      totalCount,
      page,
      limit,
    );
  }

  /**
   * Get user preferences including Pledge introduction state.
   */
  static async getUserPreferences(userId: string) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User profile not found');
    }
    const prefs = await UserRepository.getUserPreferences(userId);
    return {
      pledgeIntroSeenAt: prefs.pledgeIntroSeenAt
        ? prefs.pledgeIntroSeenAt.toISOString()
        : null,
      pledgeIntroVersion: prefs.pledgeIntroVersion ?? null,
    };
  }

  /**
   * Update user preferences including Pledge introduction state.
   */
  static async updateUserPreferences(
    userId: string,
    input: {
      pledgeIntroSeenAt?: string | null;
      pledgeIntroVersion?: string | null;
      pledgeIntroSeen?: boolean;
      pledgeIntroDismissed?: boolean;
    },
  ) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    let seenAt: Date | null | undefined = undefined;
    if (input.pledgeIntroSeen || input.pledgeIntroDismissed) {
      seenAt = new Date();
    } else if (input.pledgeIntroSeenAt !== undefined) {
      seenAt = input.pledgeIntroSeenAt ? new Date(input.pledgeIntroSeenAt) : null;
    }

    const version =
      input.pledgeIntroVersion !== undefined
        ? input.pledgeIntroVersion
        : input.pledgeIntroSeen || input.pledgeIntroDismissed
          ? 'pledge_intro_v1'
          : undefined;

    const updated = await UserRepository.updateUserPreferences(userId, {
      pledgeIntroSeenAt: seenAt,
      pledgeIntroVersion: version,
    });

    return {
      pledgeIntroSeenAt: updated.pledgeIntroSeenAt
        ? updated.pledgeIntroSeenAt.toISOString()
        : null,
      pledgeIntroVersion: updated.pledgeIntroVersion ?? null,
    };
  }
}
