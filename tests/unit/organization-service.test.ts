import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OrganizationStatus, Role } from '@prisma/client';
import { OrganizationRepository } from '../../src/repositories/organization.repository.js';
import {
  OrganizationService,
  canUpdateBranding,
} from '../../src/services/organization.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/utils/response.js';

const ORG_ID = 'e7a18492-91f2-4c22-9fa4-a4f61e890123';
const OTHER_ID = 'b2c3d4e5-f6a7-4890-bcde-f12345678901';

const BRANDING = {
  primaryColor: '#FF5722',
  logoUrl: 'https://ripskis.com/logo.png',
};

describe('M04-P01-T03 OrganizationService ownership', () => {
  it('allows SUPER_ADMIN for any organization id', () => {
    assert.equal(
      canUpdateBranding({ role: Role.SUPER_ADMIN, organizationId: null }, ORG_ID),
      true,
    );
    assert.equal(
      canUpdateBranding({ role: Role.SUPER_ADMIN, organizationId: OTHER_ID }, ORG_ID),
      true,
    );
  });

  it('allows BRAND_ADMIN only for the matching organizationId', () => {
    assert.equal(
      canUpdateBranding({ role: Role.BRAND_ADMIN, organizationId: ORG_ID }, ORG_ID),
      true,
    );
    assert.equal(
      canUpdateBranding({ role: Role.BRAND_ADMIN, organizationId: OTHER_ID }, ORG_ID),
      false,
    );
    assert.equal(
      canUpdateBranding({ role: Role.BRAND_ADMIN, organizationId: null }, ORG_ID),
      false,
    );
  });

  it('denies CREATOR and VIEWER', () => {
    assert.equal(
      canUpdateBranding({ role: Role.CREATOR, organizationId: ORG_ID }, ORG_ID),
      false,
    );
    assert.equal(
      canUpdateBranding({ role: Role.VIEWER, organizationId: null }, ORG_ID),
      false,
    );
  });

  it('does not write when a BRAND_ADMIN targets another organization', async () => {
    let writes = 0;
    const originalUpdate = OrganizationRepository.updateBranding;
    const originalFind = OrganizationRepository.findById;
    OrganizationRepository.updateBranding = (async () => {
      writes += 1;
      throw new Error('updateBranding should not be called');
    }) as unknown as typeof OrganizationRepository.updateBranding;
    OrganizationRepository.findById = (async () => {
      throw new Error('findById should not run for a cross-tenant deny');
    }) as unknown as typeof OrganizationRepository.findById;

    try {
      await assert.rejects(
        () =>
          OrganizationService.updateBranding(
            { role: Role.BRAND_ADMIN, organizationId: OTHER_ID },
            ORG_ID,
            BRANDING,
          ),
        (err: unknown) => {
          assert.ok(err instanceof ForbiddenError);
          assert.equal(err.statusCode, 403);
          return true;
        },
      );
      assert.equal(writes, 0);
    } finally {
      OrganizationRepository.updateBranding = originalUpdate;
      OrganizationRepository.findById = originalFind;
    }
  });

  it('M10-P01-T01 listOrganizations returns every repository record unchanged', async () => {
    const originalFindAll = OrganizationRepository.findAll;
    const records = [
      { id: OTHER_ID, name: 'Nike', slug: 'nike', branding: null },
      { id: ORG_ID, name: 'Ripskis', slug: 'ripskis', branding: BRANDING },
    ];
    OrganizationRepository.findAll = (async () =>
      records) as unknown as typeof OrganizationRepository.findAll;

    try {
      assert.deepEqual(await OrganizationService.listOrganizations(), records);
    } finally {
      OrganizationRepository.findAll = originalFindAll;
    }
  });

  it('M10-P01-T02/T03 suspend and reinstate deny every role except SUPER_ADMIN before any read', async () => {
    const originalFind = OrganizationRepository.findById;
    const originalSuspend = OrganizationRepository.suspend;
    const originalReinstate = OrganizationRepository.reinstate;
    OrganizationRepository.findById = (async () => {
      throw new Error('findById should not run for a denied role');
    }) as unknown as typeof OrganizationRepository.findById;
    OrganizationRepository.suspend = (async () => {
      throw new Error('suspend should not run');
    }) as unknown as typeof OrganizationRepository.suspend;
    OrganizationRepository.reinstate = (async () => {
      throw new Error('reinstate should not run');
    }) as unknown as typeof OrganizationRepository.reinstate;

    try {
      for (const actor of [
        { role: Role.BRAND_ADMIN, organizationId: ORG_ID },
        { role: Role.BRAND_ADMIN, organizationId: OTHER_ID },
        { role: Role.CREATOR, organizationId: null },
        { role: Role.VIEWER, organizationId: null },
      ]) {
        await assert.rejects(
          () => OrganizationService.suspendOrganization(actor, ORG_ID, 'reason'),
          (err: unknown) => err instanceof ForbiddenError,
        );
        await assert.rejects(
          () => OrganizationService.reinstateOrganization(actor, ORG_ID),
          (err: unknown) => err instanceof ForbiddenError,
        );
      }
    } finally {
      OrganizationRepository.findById = originalFind;
      OrganizationRepository.suspend = originalSuspend;
      OrganizationRepository.reinstate = originalReinstate;
    }
  });

  it('M10-P01-T02/T03 missing organization is 404; wrong starting state is 409', async () => {
    const originalFind = OrganizationRepository.findById;
    const superAdmin = { role: Role.SUPER_ADMIN, organizationId: null };
    try {
      OrganizationRepository.findById = (async () =>
        null) as unknown as typeof OrganizationRepository.findById;
      await assert.rejects(
        () => OrganizationService.suspendOrganization(superAdmin, ORG_ID, 'reason'),
        (err: unknown) => err instanceof NotFoundError,
      );
      await assert.rejects(
        () => OrganizationService.reinstateOrganization(superAdmin, ORG_ID),
        (err: unknown) => err instanceof NotFoundError,
      );

      OrganizationRepository.findById = (async () => ({
        id: ORG_ID,
        status: OrganizationStatus.SUSPENDED,
      })) as unknown as typeof OrganizationRepository.findById;
      await assert.rejects(
        () => OrganizationService.suspendOrganization(superAdmin, ORG_ID, 'reason'),
        (err: unknown) => err instanceof ConflictError && err.statusCode === 409,
      );

      OrganizationRepository.findById = (async () => ({
        id: ORG_ID,
        status: OrganizationStatus.ACTIVE,
      })) as unknown as typeof OrganizationRepository.findById;
      await assert.rejects(
        () => OrganizationService.reinstateOrganization(superAdmin, ORG_ID),
        (err: unknown) => err instanceof ConflictError && err.statusCode === 409,
      );
    } finally {
      OrganizationRepository.findById = originalFind;
    }
  });

  it('returns 404 when an authorized actor targets a missing organization', async () => {
    const originalFind = OrganizationRepository.findById;
    OrganizationRepository.findById = (async () =>
      null) as unknown as typeof OrganizationRepository.findById;

    try {
      await assert.rejects(
        () =>
          OrganizationService.updateBranding(
            { role: Role.SUPER_ADMIN, organizationId: null },
            ORG_ID,
            BRANDING,
          ),
        (err: unknown) => err instanceof NotFoundError,
      );
    } finally {
      OrganizationRepository.findById = originalFind;
    }
  });
});
