import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20261030193000_repair_chat_participant_guard/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('chat participant trigger', () => {
  it('does not reference NEW inside the SQL lookup', () => {
    const query = sql.slice(sql.indexOf('IF NOT EXISTS'), sql.indexOf('RAISE EXCEPTION'));
    assert.match(sql, /friendship_id := NEW\."friendshipId"/);
    assert.match(sql, /actor := NEW\."senderId"/);
    assert.match(sql, /actor := NEW\."userId"/);
    assert.equal(query.includes('NEW'), false);
    assert.match(query, /f\."id" = friendship_id/);
    assert.equal(sql.toLowerCase().includes('add column'), false);
    assert.equal(sql.toLowerCase().includes('drop table'), false);
  });
});