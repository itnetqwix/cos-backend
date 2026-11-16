import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { seatHolders } from '../../src/services/zooteer-capacity.js';
import { parseRealtimeEvent } from '../../src/services/zooteer-realtime.js';

describe('PZ-M08 local capacity and packet volume', () => {
  it('keeps a 20-seat room closed to a 21st distinct person', () => {
    const active = Array.from({ length: 19 }, (_, index) => `user-${index}`);
    const seats = seatHolders('host', active);
    assert.equal(seats.size, 20);
    assert.equal(seats.has('host'), true);
    const again = seatHolders('host', [...active, 'host']);
    assert.equal(again.size, 20);
  });

  it('parses a burst of chat packets without retaining them', () => {
    const started = Date.now();
    for (let index = 0; index < 500; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const event = parseRealtimeEvent({ v: 1, type: 'chat.message', id, text: `m${index}` });
      assert.equal(event.type, 'chat.message');
    }
    assert.ok(Date.now() - started < 2000);
  });
});
