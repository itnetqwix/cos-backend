import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatus, Role } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { ProductReviewRepository } from '../../src/repositories/product-review.repository.js';

const TESTER = '11111111-1111-4111-8111-111111111111';
const APPROVER = '22222222-2222-4222-8222-222222222222';

function capability(flags: {
  role?: Role;
  testerEnabled?: boolean;
  reviewApprovalEnabled?: boolean;
  accountStatus?: AccountStatus;
}) {
  return {
    id: TESTER,
    role: flags.role ?? Role.CREATOR,
    accountStatus: flags.accountStatus ?? AccountStatus.ACTIVE,
    testerEnabled: flags.testerEnabled ?? false,
    reviewApprovalEnabled: flags.reviewApprovalEnabled ?? false,
  };
}

describe('toke capability guards', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  const originalCapability = UserRepository.findReviewCapability;
  const originalMine = ProductReviewRepository.listMinePage;
  const originalQueue = ProductReviewRepository.listQueuePage;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    ProductReviewRepository.listMinePage = async () => ({ total: 0, rows: [] });
    ProductReviewRepository.listQueuePage = async () => ({ total: 0, rows: [] });
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findReviewCapability = originalCapability;
    ProductReviewRepository.listMinePage = originalMine;
    ProductReviewRepository.listQueuePage = originalQueue;
    await app.close();
  });

  function token(role: Role, id = TESTER): string {
    return app.jwt.sign({ id, email: `${role.toLowerCase()}@contestos.com`, role });
  }

  async function mine(auth?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/toke/reviews/mine',
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });
  }

  async function queue(auth?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/admin/toke/reviews/queue',
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });
  }

  it('rejects guests and ordinary users, and allows enabled testers and admins', async () => {
    const guest = await mine();
    assert.equal(guest.statusCode, 401);
    assert.equal(JSON.parse(guest.payload).success, false);

    UserRepository.findReviewCapability = async () => capability({ testerEnabled: false });
    const ordinary = await mine(token(Role.CREATOR));
    assert.equal(ordinary.statusCode, 403);
    assert.match(JSON.parse(ordinary.payload).message, /Tester capability/);

    UserRepository.findReviewCapability = async () => capability({ testerEnabled: true });
    const tester = await mine(token(Role.CREATOR));
    assert.equal(tester.statusCode, 200);
    assert.equal(JSON.parse(tester.payload).success, true);

    UserRepository.findReviewCapability = async () =>
      capability({ role: Role.ADMIN, testerEnabled: false });
    const admin = await mine(token(Role.ADMIN));
    assert.equal(admin.statusCode, 200);
  });

  it('allows approvers and admins, and rejects a tester without approval capability', async () => {
    const guest = await queue();
    assert.equal(guest.statusCode, 401);

    UserRepository.findReviewCapability = async () =>
      capability({ testerEnabled: true, reviewApprovalEnabled: false });
    const tester = await queue(token(Role.CREATOR));
    assert.equal(tester.statusCode, 403);
    assert.match(JSON.parse(tester.payload).message, /Review approval/);

    UserRepository.findReviewCapability = async (id: string) =>
      capability({
        testerEnabled: false,
        reviewApprovalEnabled: id === APPROVER,
      });
    const approver = await queue(token(Role.CREATOR, APPROVER));
    assert.equal(approver.statusCode, 200);

    UserRepository.findReviewCapability = async () =>
      capability({ role: Role.ADMIN, reviewApprovalEnabled: false });
    const admin = await queue(token(Role.ADMIN));
    assert.equal(admin.statusCode, 200);

    UserRepository.findReviewCapability = async () =>
      capability({ reviewApprovalEnabled: false, testerEnabled: false });
    const disabled = await queue(token(Role.CREATOR));
    assert.equal(disabled.statusCode, 403);
  });
});
