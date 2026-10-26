import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  counterStreamEvent,
  counterStreamPrelude,
  publishCounter,
  resetCounterListeners,
  subscribeCounter,
} from '../../src/services/counter-realtime.js';
import type { CounterSnapshot } from '../../src/services/counter.service.js';

function snapshot(hits: string): CounterSnapshot {
  return {
    hits,
    remainderMicros: 0,
    ratePerSecond: 1,
    asOf: '2026-10-26T00:00:00.000Z',
    paused: false,
    provisional: true,
    title: 'International Ripskis Counter',
    subtitle: 'Estimated hits worldwide',
    timezone: 'UTC',
  };
}

describe('counter realtime frames', () => {
  it('opens with a retry hint and a snapshot event', () => {
    const frame = counterStreamPrelude(snapshot('10'));
    assert.match(frame, /^retry: 3000\n\nevent: snapshot\ndata: /);
    assert.equal(JSON.parse(frame.split('data: ')[1]).hits, '10');
    assert.equal(JSON.parse(counterStreamEvent(snapshot('11')).split('data: ')[1]).hits, '11');
  });

  it('delivers the next snapshot to a new subscriber and not to one that dropped', () => {
    resetCounterListeners();
    const first: string[] = [];
    const stop = subscribeCounter((event) => first.push(event.hits));
    publishCounter(snapshot('1'));
    stop();
    publishCounter(snapshot('2'));
    const second: string[] = [];
    subscribeCounter((event) => second.push(event.hits));
    publishCounter(snapshot('3'));
    assert.deepEqual(first, ['1']);
    assert.deepEqual(second, ['3']);
    resetCounterListeners();
  });
});
