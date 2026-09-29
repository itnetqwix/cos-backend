import { env } from '../config/env.js';
import { OrganizationRepository } from '../repositories/organization.repository.js';
import { NotFoundError } from '../utils/response.js';

/**
 * One deployment has one organization. The slug comes from
 * `DEPLOYMENT_ORGANIZATION_SLUG` (default: the Woofskis demo seed slug).
 * Callers do not accept an organization id, brand, or domain from the client.
 */
export async function resolveDeploymentOrganization() {
  const organization = await OrganizationRepository.findBySlug(
    env.DEPLOYMENT_ORGANIZATION_SLUG,
  );
  if (!organization) {
    throw new NotFoundError(
      'Deployment organization was not found. Provision it before using this deployment.',
    );
  }
  return organization;
}
