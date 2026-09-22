import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, errorResponse } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';
import { env } from '../config/env.js';

/**
 * Global Fastify error handler ensuring all error responses adhere to the standard ApiResponse envelope
 * and avoiding Swagger schema serialization crashes.
 */
export function globalErrorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // 1. Handle Zod Validation Errors
  if (error instanceof ZodError) {
    const formattedErrors = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    return reply
      .status(HTTP_STATUS.BAD_REQUEST)
      .send(errorResponse('Validation error', formattedErrors));
  }

  // 2. Handle Custom Application Errors (AppError, NotFoundError, ConflictError, etc.)
  if (error instanceof AppError) {
    return reply
      .status(error.statusCode)
      .send(errorResponse(error.message, error.errors));
  }

  // 3. Handle Fastify Built-in Schema Validation Errors
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    const validationErrors = Array.isArray(fastifyError.validation)
      ? fastifyError.validation.map((v) => ({
          field:
            typeof v.instancePath === 'string' && v.instancePath
              ? v.instancePath
              : String(v.params),
          message: v.message || 'Validation failed',
        }))
      : fastifyError.validation;

    return reply
      .status(HTTP_STATUS.BAD_REQUEST)
      .send(errorResponse('Validation failed', validationErrors));
  }

  // 4. Handle HTTP Status Determination
  const statusCode =
    fastifyError.statusCode &&
    fastifyError.statusCode >= 400 &&
    fastifyError.statusCode < 600
      ? fastifyError.statusCode
      : HTTP_STATUS.INTERNAL_SERVER_ERROR;

  // 5. Server Error Logging
  if (statusCode >= 500) {
    request.log.error(error);
    console.error('💥 UNCAUGHT SERVER ERROR TRACE:', error);
  }

  const message =
    statusCode === 500 && env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : error.message || 'Internal Server Error';

  const errors =
    statusCode === 500 && env.NODE_ENV !== 'production'
      ? [error.stack ?? error.message]
      : null;

  return reply.status(statusCode).send(errorResponse(message, errors));
}
