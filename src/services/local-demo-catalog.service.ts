import { ContestRepository } from '../repositories/contest.repository.js';
import { resolveDeploymentOrganization } from './deployment-organization.js';

/**
 * Read-only catalog for TEMPORARY LOCAL CLIENT DEMO MODE.
 *
 * Registered only when STORAGE_PROVIDER=local-demo. It does not create
 * submissions, ratings, or leaderboard rows.
 */

export interface LocalDemoContestView {
  id: string;
  title: string;
  description: string;
  status: string;
  autoAdvanceDelayMs: number;
  startDate: string;
  endDate: string;
  updatedAt: string;
  organizationId: string;
}

export interface LocalDemoCatalog {
  mode: 'local-demo';
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  contests: LocalDemoContestView[];
}

function iso(value: Date): string {
  return value.toISOString();
}

export class LocalDemoCatalogService {
  static async bootstrap(): Promise<LocalDemoCatalog> {
    const organization = await resolveDeploymentOrganization();

    const contests = await ContestRepository.list({
      organizationId: organization.id,
      status: 'ACTIVE',
    });
    const active = [...contests].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );

    return {
      mode: 'local-demo',
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
      },
      contests: active.map((contest) => ({
        id: contest.id,
        title: contest.title,
        description: contest.description,
        status: contest.status,
        autoAdvanceDelayMs: contest.autoAdvanceDelayMs,
        startDate: iso(contest.startDate),
        endDate: iso(contest.endDate),
        updatedAt: iso(contest.updatedAt),
        organizationId: contest.organizationId,
      })),
    };
  }
}
