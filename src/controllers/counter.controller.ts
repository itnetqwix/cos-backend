import { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS } from '../config/constants.js';
import { CounterService } from '../services/counter.service.js';
import {
  counterStreamEvent,
  counterStreamPrelude,
  ensureCounterTicker,
  subscribeCounter,
} from '../services/counter-realtime.js';
import { UnauthorizedError, sendSuccess } from '../utils/response.js';

function actorId(request: FastifyRequest): string {
  const id = request.user?.id;
  if (!id) throw new UnauthorizedError('Unauthorized: Authentication required');
  return id;
}

export class CounterController {
  static async snapshot(_request: FastifyRequest, reply: FastifyReply) {
    const snapshot = await CounterService.snapshot();
    return sendSuccess(reply, snapshot, 'Counter snapshot retrieved', HTTP_STATUS.OK);
  }

  static async adminGet(_request: FastifyRequest, reply: FastifyReply) {
    const view = await CounterService.adminView();
    return sendSuccess(reply, view, 'Counter configuration retrieved', HTTP_STATUS.OK);
  }

  static async adminUpdate(request: FastifyRequest, reply: FastifyReply) {
    const view = await CounterService.update(actorId(request), request.body ?? {});
    return sendSuccess(reply, view, 'Counter configuration updated', HTTP_STATUS.OK);
  }

  static async stream(_request: FastifyRequest, reply: FastifyReply) {
    const snapshot = await CounterService.snapshot();
    if (reply.sent) return;
    reply.hijack();
    let closed = false;
    let unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
    };
    const write = (chunk: string) => {
      if (closed || reply.raw.writableEnded || reply.raw.destroyed) {
        close();
        return;
      }
      try {
        reply.raw.write(chunk);
      } catch {
        close();
      }
    };

    reply.raw.on('error', close);
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
    }
    write(counterStreamPrelude(snapshot));
    unsubscribe = subscribeCounter((event) => write(counterStreamEvent(event)));
    ensureCounterTicker(() => CounterService.snapshot());
    _request.raw.on('close', close);
    reply.raw.on('close', close);
  }
}
