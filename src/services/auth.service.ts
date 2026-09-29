import { FastifyInstance } from 'fastify';
import { UserRepository } from '../repositories/user.repository.js';
import { hashPassword, comparePassword } from '../utils/crypto.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../utils/response.js';
import { sanitizeUser } from '../utils/sanitize-user.js';
import { RegisterCreatorInput, LoginInput } from '../schemas/auth.schema.js';

export class AuthService {
  /**
   * Register a creator. Body is email, password, and name.
   * Password is bcrypt-hashed before persist. JWT claims are `{ id, email, role }`.
   * There is no public admin registration.
   */
  static async registerCreator(input: RegisterCreatorInput, fastify: FastifyInstance) {
    const { email, password, name } = input;

    const existingUser = await UserRepository.findByEmail(email);
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    const passwordHash = await hashPassword(password);
    const user = await UserRepository.createCreator({
      email,
      passwordHash,
      name,
    });

    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      user: sanitizeUser(user),
      token,
    };
  }

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
    });

    return {
      user: sanitizeUser(user),
      token,
    };
  }

  static async getCurrentUser(userId: string) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User profile not found');
    }

    return sanitizeUser(user);
  }
}
