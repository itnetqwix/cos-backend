import { isIP } from 'node:net';

/**
 * Origins discovered from this repo, not guessed:
 * - Frontend: `content-operating-system/Dockerfile.prod` `NEXT_PUBLIC_APP_URL=https://www.ripskis.com`
 * - Apex: `src/features/judging/lib/share-url.ts` treats `https://ripskis.com` as a page origin
 * - API: `Dockerfile.prod` and `docs/LOCAL-DEMO-MODE.md` `https://api.ripskis.com`
 *
 * www/apex and api.ripskis.com share the registrable domain ripskis.com (same-site, cross-origin).
 * Local default is the frontend on port 3000 and this API on `PORT`.
 *
 * ponytail: site key is scheme + last two host labels, not the public suffix list.
 * Set GUEST_COOKIE_SAMESITE=none when the real registrable domain has more than one label (example.co.uk).
 */

export const DISCOVERED_PRODUCTION_FRONTEND_ORIGINS = [
  'https://www.ripskis.com',
  'https://ripskis.com',
] as const;

export const DISCOVERED_PRODUCTION_API_ORIGIN = 'https://api.ripskis.com';

export const LOCAL_FRONTEND_ORIGIN = 'http://localhost:3000';

export type GuestCookieSameSite = 'lax' | 'none';

export interface DeploymentCors {
  origins: string[];
  apiOrigin: string;
  sameSite: GuestCookieSameSite;
}

export function assertHttpOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not an absolute http(s) origin: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must be http or https: ${value}`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials: ${value}`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${label} must not include a path: ${value}`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} must not include a query or hash: ${value}`);
  }
  if (url.origin === 'null' || value.includes('*')) {
    throw new Error(`${label} must be an explicit origin, not a wildcard: ${value}`);
  }
  return url.origin;
}

export function schemefulSite(origin: string): string {
  const url = new URL(origin);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isIP(host) !== 0) {
    return `${url.protocol}//${host}`;
  }
  const labels = host.split('.').filter(Boolean);
  const registrable = labels.length >= 2 ? labels.slice(-2).join('.') : host;
  return `${url.protocol}//${registrable}`;
}

function splitList(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isLoopbackOrigin(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function resolveDeploymentCors(input: {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  corsOrigins?: string;
  apiPublicOrigin?: string;
  sameSiteOverride?: GuestCookieSameSite;
}): DeploymentCors {
  const listed = splitList(input.corsOrigins);
  const originSource =
    listed.length > 0
      ? listed
      : input.nodeEnv === 'production'
        ? [...DISCOVERED_PRODUCTION_FRONTEND_ORIGINS]
        : [LOCAL_FRONTEND_ORIGIN];
  if (originSource.some((item) => item === '*')) {
    throw new Error('CORS_ORIGINS cannot be *');
  }
  const origins = originSource.map((item) => assertHttpOrigin(item, 'CORS_ORIGINS'));
  const unique = [...new Set(origins)];

  const apiRaw =
    input.apiPublicOrigin?.trim() ||
    (input.nodeEnv === 'production'
      ? DISCOVERED_PRODUCTION_API_ORIGIN
      : `http://localhost:${input.port}`);
  const apiOrigin = assertHttpOrigin(apiRaw, 'API_PUBLIC_ORIGIN');

  if (input.nodeEnv === 'production') {
    if (unique.every(isLoopbackOrigin)) {
      throw new Error(
        'CORS_ORIGINS is loopback while NODE_ENV=production. Set the deployed frontend origins.',
      );
    }
    if (isLoopbackOrigin(apiOrigin)) {
      throw new Error(
        'API_PUBLIC_ORIGIN is loopback while NODE_ENV=production. Set the deployed API origin.',
      );
    }
  }

  const detected: GuestCookieSameSite = unique.every(
    (origin) => schemefulSite(origin) === schemefulSite(apiOrigin),
  )
    ? 'lax'
    : 'none';
  if (input.sameSiteOverride === 'lax' && detected === 'none') {
    throw new Error(
      'GUEST_COOKIE_SAMESITE=lax but a CORS origin is cross-site to API_PUBLIC_ORIGIN. Use none, or align the hosts.',
    );
  }
  return {
    origins: unique,
    apiOrigin,
    sameSite: input.sameSiteOverride ?? detected,
  };
}

/** Allow only listed origins. Missing Origin (curl, server-to-server) skips CORS headers. */
export function corsOriginDecision(
  requestOrigin: string | undefined,
  allowed: readonly string[],
): string | false {
  if (!requestOrigin) return false;
  return allowed.includes(requestOrigin) ? requestOrigin : false;
}
