import { FastifyReply, FastifyRequest } from 'fastify';
import { LocalDemoCatalogService } from '../services/local-demo-catalog.service.js';
import { sendSuccess } from '../utils/response.js';

/**
 * TEMPORARY LOCAL CLIENT DEMO MODE.
 * Public read of the seeded demo organization and contest. No credentials.
 */
export class LocalDemoCatalogController {
  static async bootstrap(_request: FastifyRequest, reply: FastifyReply) {
    const catalog = await LocalDemoCatalogService.bootstrap();
    return sendSuccess(reply, catalog, 'Temporary local demo catalog');
  }
}
