import { FastifyInstance } from 'fastify';
import { UserRepository } from '../repositories/user.repository.js';
import { hashPassword, comparePassword } from '../utils/crypto.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../utils/response.js';
import {
  RegisterCreatorInput,
  RegisterBrandInput,
  LoginInput,
} from '../schemas/auth.schema.js';

export class AuthService {
  /**
   * Register a new Creator user.
   */
  static async registerCreator(input: RegisterCreatorInput, fastify: FastifyInstance) {
    const { email, password, name } = input;

    // Check if user already exists
    const existingUser = await UserRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    // Hash password with bcrypt
    const passwordHash = await hashPassword(password);

    // Persist Creator user via repository
    const user = await UserRepository.createCreator({
      email,
      passwordHash,
      name,
    });

    // Sign JWT access token
    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    });

    return {
      user,
      token,
    };
  }

  /**
   * Register a Brand organization along with the initial Brand Admin user.
   */
  static async registerBrand(input: RegisterBrandInput, fastify: FastifyInstance) {
    const { email, password, name, organizationName, slug } = input;

    // Pre-check duplicate email
    const existingUser = await UserRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    // Pre-check duplicate organization slug
    const existingOrg = await UserRepository.findOrganizationBySlug(slug);
    if (existingOrg) {
      throw new ConflictError('Organization with this slug already exists');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Atomically persist organization & brand admin user via repository
    const result = await UserRepository.createBrandWithOrganization({
      email,
      passwordHash,
      name,
      organizationName,
      slug,
    });

    // Sign JWT access token
    const token = fastify.jwt.sign({
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
      organizationId: result.organization.id,
    });

    return {
      user: result.user,
      organization: result.organization,
      token,
    };
  }

  /**
   * Authenticate user with email and password.
   */
  static async login(input: LoginInput, fastify: FastifyInstance) {
    const { email, password } = input;

    const user = await UserRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isPasswordValid = await comparePassword(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    });

    // Sanitize user object (exclude sensitive passwordHash)
    const sanitizedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return {
      user: sanitizedUser,
      token,
    };
  }

  /**
   * Fetch current authenticated user profile.
   */
  static async getCurrentUser(userId: string) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    return user;
  }
}
