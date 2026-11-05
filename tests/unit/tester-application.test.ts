import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatus, Role, TesterApplicationStatus, TesterStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { TesterApplicationRepository } from '../../src/repositories/tester-application.repository.js';

const APPLICANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APP_ID = '11111111-2222-4333-8444-555555555555';
const ADMIN_APP_ID = '99999999-9999-4999-8999-999999999999';

describe('Phase 2 Tester Application & Governance API', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  const originalCapability = UserRepository.findReviewCapability;
  const originalFindById = UserRepository.findById;
  const originalCreateApp = TesterApplicationRepository.create;
  const originalFindActive = TesterApplicationRepository.findActiveByUserId;
  const originalFindLatest = TesterApplicationRepository.findLatestByUserId;
  const originalFindAppById = TesterApplicationRepository.findById;
  const originalUpdateApp = TesterApplicationRepository.update;
  const originalUpdateUserTester = TesterApplicationRepository.updateUserTesterStatus;
  const originalRecordAudit = TesterApplicationRepository.recordAuditLog;
  const originalListApps = TesterApplicationRepository.listApplicationsPage;
  const originalListTesters = TesterApplicationRepository.listTestersPage;
  const originalTx = TesterApplicationRepository.transaction;

  // In-memory test store
  const applications = new Map<string, any>();
  const users = new Map<string, any>();
  const auditLogs: any[] = [];

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';

    users.set(APPLICANT_ID, {
      id: APPLICANT_ID,
      email: 'applicant@contestos.com',
      name: 'Test Applicant',
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      reviewApprovalEnabled: false,
    });

    users.set(ADMIN_ID, {
      id: ADMIN_ID,
      email: 'admin@contestos.com',
      name: 'Test Admin',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      reviewApprovalEnabled: true,
    });

    UserRepository.findById = async (id: string) => {
      const u = users.get(id);
      return u ? { ...u } : null;
    };

    UserRepository.findReviewCapability = async (id: string) => {
      const u = users.get(id);
      return u
        ? {
            id: u.id,
            role: u.role,
            accountStatus: u.accountStatus,
            testerStatus: u.testerStatus,
            reviewApprovalEnabled: u.reviewApprovalEnabled,
          }
        : null;
    };

    TesterApplicationRepository.create = async (data) => {
      const appRecord = {
        id: APP_ID,
        ...data,
        status: TesterApplicationStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      applications.set(appRecord.id, appRecord);
      return appRecord;
    };

    TesterApplicationRepository.findActiveByUserId = async (userId: string) => {
      for (const app of applications.values()) {
        if (
          app.userId === userId &&
          [
            TesterApplicationStatus.PENDING,
            TesterApplicationStatus.UNDER_REVIEW,
            TesterApplicationStatus.NEEDS_INFORMATION,
            TesterApplicationStatus.APPROVED,
          ].includes(app.status)
        ) {
          return { ...app };
        }
      }
      return null;
    };

    TesterApplicationRepository.findLatestByUserId = async (userId: string) => {
      let latest: any = null;
      for (const app of applications.values()) {
        if (app.userId === userId) {
          if (!latest || app.createdAt > latest.createdAt) {
            latest = app;
          }
        }
      }
      return latest ? { ...latest, reviewedBy: null, auditLogs: [] } : null;
    };

    TesterApplicationRepository.findById = async (id: string) => {
      const app = applications.get(id);
      if (!app) return null;
      const u = users.get(app.userId);
      return {
        ...app,
        user: u ? { ...u } : null,
        reviewedBy: null,
        auditLogs: [],
      };
    };

    TesterApplicationRepository.update = async (id, data) => {
      const existing = applications.get(id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, ...data, updatedAt: new Date() };
      applications.set(id, updated);
      return updated;
    };

    TesterApplicationRepository.updateUserTesterStatus = async (userId, testerStatus, bio) => {
      const u = users.get(userId);
      if (!u) throw new Error('User not found');
      u.testerStatus = testerStatus;
      if (bio) u.testerBio = bio;
      users.set(userId, u);
      return { ...u };
    };

    TesterApplicationRepository.recordAuditLog = async (data) => {
      const log = { id: 'audit-' + auditLogs.length, ...data, createdAt: new Date() };
      auditLogs.push(log);
      return log as any;
    };

    TesterApplicationRepository.listApplicationsPage = async (params) => {
      const all = Array.from(applications.values()).filter((a) => {
        if (params.status && a.status !== params.status) return false;
        return true;
      });
      return { rows: all, total: all.length };
    };

    TesterApplicationRepository.listTestersPage = async (params) => {
      const all = Array.from(users.values()).filter((u) => {
        if (params.status && u.testerStatus !== params.status) return false;
        return true;
      });
      return { rows: all, total: all.length };
    };

    TesterApplicationRepository.transaction = async (fn) => fn({} as any);

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findReviewCapability = originalCapability;
    UserRepository.findById = originalFindById;
    TesterApplicationRepository.create = originalCreateApp;
    TesterApplicationRepository.findActiveByUserId = originalFindActive;
    TesterApplicationRepository.findLatestByUserId = originalFindLatest;
    TesterApplicationRepository.findById = originalFindAppById;
    TesterApplicationRepository.update = originalUpdateApp;
    TesterApplicationRepository.updateUserTesterStatus = originalUpdateUserTester;
    TesterApplicationRepository.recordAuditLog = originalRecordAudit;
    TesterApplicationRepository.listApplicationsPage = originalListApps;
    TesterApplicationRepository.listTestersPage = originalListTesters;
    TesterApplicationRepository.transaction = originalTx;
    await app.close();
  });

  function token(id: string, role = Role.CREATOR): string {
    return app.jwt.sign({ id, email: `${id.slice(0, 8)}@contestos.com`, role });
  }

  it('rejects unauthenticated requests to /tester/apply', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tester/apply',
      payload: { fullName: 'Test', email: 'test@example.com' },
    });
    assert.equal(res.statusCode, 401);
  });

  it('submits a new tester application and retrieves mine status', async () => {
    const submitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tester/apply',
      headers: { authorization: `Bearer ${token(APPLICANT_ID)}` },
      payload: {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
        phoneNumber: '+1-555-0100',
        city: 'Denver',
        state: 'CO',
        country: 'USA',
        bio: 'Professional cannabis sommelier with 8 years of grading experience.',
        experienceYears: 8,
        preferredProductTypes: ['Flower', 'Concentrate'],
        languages: ['English', 'Spanish'],
        credentials: 'Certified Ganjier #402',
        sampleReviewUrl: 'https://example.com/reviews/jane-1',
        applicantNotes: 'Excited to review for One Toke!',
      },
    });

    assert.equal(submitRes.statusCode, 201);
    const body = JSON.parse(submitRes.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'PENDING');
    assert.equal(body.data.fullName, 'Jane Doe');

    // Retrieve mine
    const mineRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tester/application/mine',
      headers: { authorization: `Bearer ${token(APPLICANT_ID)}` },
    });
    assert.equal(mineRes.statusCode, 200);
    const mineBody = JSON.parse(mineRes.payload);
    assert.equal(mineBody.data.isVerified, false);
    assert.equal(mineBody.data.application.status, 'PENDING');
  });

  it('prevents duplicate active applications', async () => {
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tester/apply',
      headers: { authorization: `Bearer ${token(APPLICANT_ID)}` },
      payload: {
        fullName: 'Jane Doe',
        email: 'jane@example.com',
      },
    });
    assert.equal(duplicateRes.statusCode, 409);
    assert.match(JSON.parse(duplicateRes.payload).message, /already in progress/);
  });

  it('admin marks application under review and requests information', async () => {
    // Mark under review
    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/applications/${APP_ID}/review`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(reviewRes.statusCode, 200);
    assert.equal(JSON.parse(reviewRes.payload).data.status, 'UNDER_REVIEW');

    // Request information
    const reqInfoRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/applications/${APP_ID}/request-info`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
      payload: {
        notes: 'Please attach proof of your Ganjier certification or certificate number.',
      },
    });
    assert.equal(reqInfoRes.statusCode, 200);
    assert.equal(JSON.parse(reqInfoRes.payload).data.status, 'NEEDS_INFORMATION');
  });

  it('applicant responds to information request', async () => {
    const respondRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tester/application/mine/respond',
      headers: { authorization: `Bearer ${token(APPLICANT_ID)}` },
      payload: {
        notes: 'Certificate ID is GNJ-2024-402, verified with the Ganjier registry.',
        credentials: 'Certified Ganjier #402 (Registry verified)',
      },
    });
    assert.equal(respondRes.statusCode, 200);
    assert.equal(JSON.parse(respondRes.payload).data.status, 'UNDER_REVIEW');
  });

  it('prevents self-approval by administrator', async () => {
    // Create an application for the admin user
    applications.set(ADMIN_APP_ID, {
      id: ADMIN_APP_ID,
      userId: ADMIN_ID,
      status: TesterApplicationStatus.PENDING,
      fullName: 'Admin User',
      email: 'admin@contestos.com',
    });

    const selfApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/applications/${ADMIN_APP_ID}/approve`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(selfApproveRes.statusCode, 403);
    assert.match(JSON.parse(selfApproveRes.payload).message, /Cannot approve your own/);
  });

  it('admin approves applicant and verifies tester access is activated', async () => {
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/applications/${APP_ID}/approve`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(approveRes.statusCode, 200);
    assert.equal(JSON.parse(approveRes.payload).data.status, 'APPROVED');

    // Verify user testerStatus is now VERIFIED
    const user = users.get(APPLICANT_ID);
    assert.equal(user.testerStatus, TesterStatus.VERIFIED);
  });

  it('admin suspends, revokes, and reinstates verified tester', async () => {
    // Suspend
    const suspendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/testers/${APPLICANT_ID}/suspend`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
      payload: { reason: 'Pending compliance check on dispensary claims.' },
    });
    assert.equal(suspendRes.statusCode, 200);
    assert.equal(users.get(APPLICANT_ID).testerStatus, TesterStatus.SUSPENDED);

    // Revoke
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/testers/${APPLICANT_ID}/revoke`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
      payload: { reason: 'Confirmed breach of tester terms.' },
    });
    assert.equal(revokeRes.statusCode, 200);
    assert.equal(users.get(APPLICANT_ID).testerStatus, TesterStatus.REVOKED);

    // Reinstate
    const reinstateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/testers/${APPLICANT_ID}/reinstate`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
      payload: { notes: 'Appeal granted after review.' },
    });
    assert.equal(reinstateRes.statusCode, 200);
    assert.equal(users.get(APPLICANT_ID).testerStatus, TesterStatus.VERIFIED);
  });
});
