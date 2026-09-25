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
}
