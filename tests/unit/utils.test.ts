import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, comparePassword } from '../../src/utils/crypto.js';
import { parsePaginationParams, buildPaginationMeta } from '../../src/utils/pagination.js';
import {
  successResponse,
  errorResponse,
  sendSuccess,
  sendError,
} from '../../src/utils/response.js';
import type { FastifyReply } from 'fastify';

describe('Unit Tests: Core Utilities', () => {
  describe('Crypto Utility', () => {
    it('hashes and verifies plain text password', async () => {
      const password = 'enterpriseSecurePassword99!';
      const hash = await hashPassword(password);

      assert.ok(hash.startsWith('$2'));
      assert.equal(await comparePassword(password, hash), true);
      assert.equal(await comparePassword('wrongPass', hash), false);
    });
  });

  describe('Pagination Utility', () => {
    it('correctly parses default pagination params', () => {
      const { page, limit, skip } = parsePaginationParams();
      assert.equal(page, 1);
      assert.equal(limit, 20);
      assert.equal(skip, 0);
    });

    it('correctly parses custom pagination params with skip calculation', () => {
      const { page, limit, skip } = parsePaginationParams({ page: 3, limit: 15 });
      assert.equal(page, 3);
      assert.equal(limit, 15);
      assert.equal(skip, 30);
    });

    it('builds accurate pagination metadata', () => {
      const meta = buildPaginationMeta(45, 2, 20);
      assert.equal(meta.totalCount, 45);
      assert.equal(meta.totalPages, 3);
      assert.equal(meta.currentPage, 2);
      assert.equal(meta.hasNextPage, true);
      assert.equal(meta.hasPrevPage, true);
    });
  });

  describe('Response Envelope Utility', () => {
    const ENVELOPE_KEYS = ['success', 'message', 'data', 'errors'];

    function createReplyMock() {
      const reply = {
        statusCode: 0,
        payload: undefined as unknown,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        send(body: unknown) {
          this.payload = body;
          return this;
        },
      };
      return reply;
    }

    it('builds standard success envelope', () => {
      const res = successResponse({ id: '123' }, 'Custom message');
      assert.equal(res.success, true);
      assert.equal(res.message, 'Custom message');
      assert.deepEqual(res.data, { id: '123' });
      assert.equal(res.errors, null);
      assert.deepEqual(Object.keys(res).sort(), [...ENVELOPE_KEYS].sort());
      assert.equal('timestamp' in res, false);
    });

    it('applies success envelope defaults', () => {
      const res = successResponse({ ok: true });
      assert.equal(res.success, true);
      assert.equal(res.message, 'Operation completed successfully');
      assert.equal(res.errors, null);
    });

    it('builds standard error envelope', () => {
      const res = errorResponse('Something failed', [{ field: 'email', message: 'Required' }]);
      assert.equal(res.success, false);
      assert.equal(res.message, 'Something failed');
      assert.equal(res.data, null);
      assert.equal((res.errors as Array<{ field: string }>)[0].field, 'email');
      assert.deepEqual(Object.keys(res).sort(), [...ENVELOPE_KEYS].sort());
      assert.equal('timestamp' in res, false);
    });

    it('applies error envelope defaults', () => {
      const res = errorResponse();
      assert.equal(res.success, false);
      assert.equal(res.message, 'An unexpected error occurred');
      assert.equal(res.data, null);
      assert.equal(res.errors, null);
    });

    it('sendSuccess writes success envelope and status', () => {
      const reply = createReplyMock();
      sendSuccess(reply as unknown as FastifyReply, { id: '123' }, 'Done', 201);
      assert.equal(reply.statusCode, 201);
      assert.deepEqual(reply.payload, {
        success: true,
        message: 'Done',
        data: { id: '123' },
        errors: null,
      });
    });

    it('sendError writes error envelope and status', () => {
      const reply = createReplyMock();
      sendError(
        reply as unknown as FastifyReply,
        'Validation failed',
        400,
        [{ field: 'email', message: 'Required' }],
      );
      assert.equal(reply.statusCode, 400);
      assert.deepEqual(reply.payload, {
        success: false,
        message: 'Validation failed',
        data: null,
        errors: [{ field: 'email', message: 'Required' }],
      });
    });

    it('sendError applies helper defaults', () => {
      const reply = createReplyMock();
      sendError(reply as unknown as FastifyReply);
      assert.equal(reply.statusCode, 400);
      assert.deepEqual(reply.payload, {
        success: false,
        message: 'An error occurred',
        data: null,
        errors: null,
      });
    });
  });
});
