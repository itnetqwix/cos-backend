/**
 * Refuses a non-local DATABASE_URL. Does not migrate, connect, or read .env.
 *
 *   DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/dating_verify" \
 *     npx tsx scripts/dating-local-preflight.ts
 */
const raw = process.env.DATABASE_URL ?? '';
if (!raw) {
  console.error('Set DATABASE_URL to a localhost database. This script does not read .env.');
  process.exit(1);
}
let host = '';
try {
  host = new URL(raw).hostname;
} catch {
  console.error('DATABASE_URL is not a URL. Refusing.');
  process.exit(1);
}
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error(`Refusing database host "${host}". Use 127.0.0.1 or localhost.`);
  process.exit(1);
}
console.log(`Local database host accepted (${host}). No migration was applied.`);
