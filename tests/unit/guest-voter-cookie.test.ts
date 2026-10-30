import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GUEST_VOTER_COOKIE,
  guestVoterCookieOptions,
  guestVoterSetCookie,
  issueGuestVoterToken,
  readGuestVoterCookie,
  resolveGuestVoterToken,
} from '../../src/services/guest-voter-cookie.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('guest voter cookie', () => {
  it('issues an opaque token and reuses only a valid cookie', () => {
    const token = issueGuestVoterToken();
    assert.equal(token.includes('.'), false);
    assert.equal(readGuestVoterCookie(`${GUEST_VOTER_COOKIE}=${token}`), token);
    const again = resolveGuestVoterToken(`${GUEST_VOTER_COOKIE}=${token}`);
    assert.equal(again.reused, true);
    assert.equal(again.token, token);

    const replaced = resolveGuestVoterToken(`${GUEST_VOTER_COOKIE}=not-a-token`);
    assert.equal(replaced.reused, false);
    assert.notEqual(replaced.token, 'not-a-token');
    assert.equal(readGuestVoterCookie('other=1'), null);
  });

  it('sets a host-only HttpOnly cookie for 400 days', () => {
    const token = issueGuestVoterToken();
    const lax = guestVoterCookieOptions({ nodeEnv: 'development', sameSite: 'lax' });
    const header = guestVoterSetCookie(token, lax);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Path=\//);
    assert.match(header, /Max-Age=34560000/);
    assert.equal(header.includes('Secure'), false);
    assert.equal(header.includes('Domain='), false);
    assert.equal(readGuestVoterCookie(header), token);

    const production = guestVoterSetCookie(
      token,
      guestVoterCookieOptions({ nodeEnv: 'production', sameSite: 'lax' }),
    );
    assert.match(production, /SameSite=Lax/);
    assert.match(production, /Secure/);
    assert.equal(production.includes('Domain='), false);

    const crossSite = guestVoterSetCookie(
      token,
      guestVoterCookieOptions({ nodeEnv: 'development', sameSite: 'none' }),
    );
    assert.match(crossSite, /SameSite=None/);
    assert.match(crossSite, /Secure/);
    assert.equal(crossSite.includes('Domain='), false);
  });

  it('drops the IP unique index and adds the winner audit action in SQL', () => {
    const schema = readFileSync(`${root}/prisma/schema.prisma`, 'utf8');
    const sql = readFileSync(
      `${root}/prisma/migrations/20261030124500_guest_voter_identity_and_winner_audit/migration.sql`,
      'utf8',
    );
    assert.match(schema, /@@unique\(\[submissionId, userId\]\)/);
    assert.match(schema, /@@unique\(\[submissionId, guestVoterId\]\)/);
    assert.doesNotMatch(schema, /@@unique\(\[submissionId, voterIpHash\]\)/);
    assert.match(schema, /@@index\(\[voterIpHash, submissionId\]\)/);
    assert.match(schema, /CORRECT_WINNER/);
    assert.match(sql, /DROP INDEX IF EXISTS "ratings_submissionId_voterIpHash_key"/);
    assert.match(sql, /ADD VALUE IF NOT EXISTS 'CORRECT_WINNER'/);
    assert.equal(sql.toLowerCase().includes('delete from'), false);
  });
});
