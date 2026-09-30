import { FastifyRequest } from 'fastify';

/**
 * Client address used for guest vote uniqueness.
 *
 * Source: Fastify `request.ip`.
 * When `TRUST_PROXY_HOPS` is 0, that is the TCP socket address.
 * When it is greater than 0 (production default is 1), Fastify `trustProxy`
 * is enabled and `request.ip` is the client address recorded by the proxy.
 * This file does not read `X-Forwarded-For` or any caller-chosen header itself.
 *
 * The value is not a physical device id. Phones on the same network can
 * share it, and one phone can change address.
 */
export function clientIp(request: FastifyRequest): string {
  const address = request.ip?.trim();
  if (!address) {
    return 'unknown';
  }
  return address;
}
