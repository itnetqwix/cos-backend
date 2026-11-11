import { z } from 'zod';
import { FastifySchema } from 'fastify';
import { swaggerErrorEnvelope, swaggerSuccessEnvelope } from './auth.schema.js';

// -------------------------------------------------------------
// 1. Zod Validation Schemas & Inferred Types
// -------------------------------------------------------------

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Invalid email address format').toLowerCase(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, 'Password reset token is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters long')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string().optional(),
  })
  .refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Verification token is required'),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const verifyEmailSwaggerSchema: FastifySchema = {
  description:
    'Confirm a signup email verification link. Login stays blocked until this succeeds.',
  tags: ['Authentication'],
  body: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', description: 'Token from the verification email' },
    },
  },
  response: {
    200: {
      description: 'Email verified',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: { verified: { type: 'boolean', example: true } },
        },
        'Email verified. You can sign in.',
      ),
    },
    400: swaggerErrorEnvelope('Invalid or expired verification link'),
    429: swaggerErrorEnvelope('Too many requests'),
  },
};

export const verifyResetTokenSchema = z.object({
  token: z.string().trim().min(1, 'Password reset token is required'),
});

export type VerifyResetTokenInput = z.infer<typeof verifyResetTokenSchema>;

// -------------------------------------------------------------
// 2. Swagger / OpenAPI JSON Schema Definitions
// -------------------------------------------------------------

export const forgotPasswordSwaggerSchema: FastifySchema = {
  description:
    'Request a password reset link to be sent to the registered email address.',
  tags: ['Authentication'],
  body: {
    type: 'object',
    required: ['email'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        example: 'creator@contestos.com',
      },
    },
  },
  response: {
    200: {
      description: 'Generic success response',
      ...swaggerSuccessEnvelope(
        { type: 'null' },
        'If an account exists with this email, password reset instructions have been sent.',
      ),
    },
    400: swaggerErrorEnvelope('Validation error'),
    429: swaggerErrorEnvelope('Too many requests'),
  },
};

export const resetPasswordSwaggerSchema: FastifySchema = {
  description: 'Reset user password using token received via email.',
  tags: ['Authentication'],
  body: {
    type: 'object',
    required: ['token', 'password'],
    properties: {
      token: {
        type: 'string',
        description: 'Password reset token from recovery email',
      },
      password: {
        type: 'string',
        minLength: 8,
        description: 'New password (min 8 chars, uppercase, lowercase, number)',
      },
      confirmPassword: {
        type: 'string',
        description: 'Optional confirmation of new password',
      },
    },
  },
  response: {
    200: {
      description: 'Password successfully reset',
      ...swaggerSuccessEnvelope(
        { type: 'null' },
        'Password has been reset successfully. You can now sign in with your new password.',
      ),
    },
    400: swaggerErrorEnvelope('Validation error or expired/invalid token'),
    429: swaggerErrorEnvelope('Too many requests'),
  },
};

export const verifyResetTokenSwaggerSchema: FastifySchema = {
  description:
    'Check if a password reset token is valid and unexpired before presenting the reset form.',
  tags: ['Authentication'],
  querystring: {
    type: 'object',
    required: ['token'],
    properties: {
      token: {
        type: 'string',
        description: 'Password reset token to check',
      },
    },
  },
  response: {
    200: {
      description: 'Token is valid',
      ...swaggerSuccessEnvelope(
        {
          type: 'object',
          properties: {
            valid: { type: 'boolean', example: true },
          },
        },
        'Token is valid',
      ),
    },
    400: swaggerErrorEnvelope('Invalid or expired password reset token'),
    429: swaggerErrorEnvelope('Too many requests'),
  },
};
