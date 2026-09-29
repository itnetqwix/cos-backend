import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app.js';
import { AuthService } from '../../src/services/auth.service.js';
import { ContestService } from '../../src/services/contest.service.js';
import { ContestRepository } from '../../src/repositories/contest.repository.js';
import { OrganizationRepository } from '../../src/repositories/organization.repository.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { NotFoundError } from '../../src/utils/response.js';

const DEPLOYMENT_ORG_ID = '11111111-1111-4111-8111-111111111111';

describe('single-organization deployment', () => {
  let app: FastifyInstance;
  let originalFindBySlug: typeof OrganizationRepository.findBySlug;
  let originalFindByEmail: typeof UserRepository.findByEmail;
  let originalCreateCreator: typeof UserRepository.createCreator;
  let originalList: typeof ContestRepository.list;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';
    originalFindBySlug = OrganizationRepository.findBySlug;
    originalFindByEmail = UserRepository.findByEmail;
    originalCreateCreator = UserRepository.createCreator;
    originalList = ContestRepository.list;
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    OrganizationRepository.findBySlug = originalFindBySlug;
    UserRepository.findByEmail = originalFindByEmail;
    UserRepository.createCreator = originalCreateCreator;
    ContestRepository.list = originalList;
    await app.close();
  });

  it('assigns creator signup to the deployment organization', async () => {
    OrganizationRepository.findBySlug = (async () => ({
      id: DEPLOYMENT_ORG_ID,
      name: 'Woofskis Demo',
      slug: 'woofskis-demo',
      branding: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as typeof OrganizationRepository.findBySlug;
    UserRepository.findByEmail = (async () => null) as typeof UserRepository.findByEmail;

    let assignedOrganizationId = '';
    UserRepository.createCreator = (async (data) => {
      assignedOrganizationId = data.organizationId;
      return {
        id: 'creator-deployment',
        email: data.email,
        name: data.name,
        role: Role.CREATOR,
        organizationId: data.organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }) as typeof UserRepository.createCreator;

    const result = await AuthService.registerCreator(
      {
        email: 'new-creator@woofskis.test',
        password: 'password123',
        name: 'New Creator',
      },
      app,
    );

    assert.equal(assignedOrganizationId, DEPLOYMENT_ORG_ID);
    assert.equal(result.user.organizationId, DEPLOYMENT_ORG_ID);
    const claims = app.jwt.verify<{ organizationId: string; role: string }>(result.token);
    assert.equal(claims.role, Role.CREATOR);
    assert.equal(claims.organizationId, DEPLOYMENT_ORG_ID);
  });

  it('rejects creator signup when the deployment organization is not provisioned', async () => {
    OrganizationRepository.findBySlug = (async () => null) as typeof OrganizationRepository.findBySlug;
    UserRepository.findByEmail = (async () => null) as typeof UserRepository.findByEmail;
    UserRepository.createCreator = (async () => {
      throw new Error('createCreator must not run');
    }) as typeof UserRepository.createCreator;

    await assert.rejects(
      () =>
        AuthService.registerCreator(
          {
            email: 'missing-org@woofskis.test',
            password: 'password123',
            name: 'Missing Org',
          },
          app,
        ),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  it('lists only ACTIVE contests for the deployment organization', async () => {
    OrganizationRepository.findBySlug = (async () => ({
      id: DEPLOYMENT_ORG_ID,
      name: 'Woofskis Demo',
      slug: 'woofskis-demo',
      branding: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as typeof OrganizationRepository.findBySlug;

    let filters: { organizationId?: string; status?: string } | undefined;
    ContestRepository.list = (async (input) => {
      filters = input;
      return [];
    }) as typeof ContestRepository.list;

    const contests = await ContestService.listDeploymentActive();
    assert.deepEqual(contests, []);
    assert.deepEqual(filters, {
      organizationId: DEPLOYMENT_ORG_ID,
      status: 'ACTIVE',
    });
  });
});
