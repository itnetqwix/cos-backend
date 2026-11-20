import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Objects Prisma will not keep unless a migration still creates them. */
export const DATING_SQL_PROTECTIONS = [
  'chk_dating_match_canonical_order',
  'chk_dating_match_no_self',
  'chk_dating_like_no_self',
  'chk_dating_block_no_self',
  'chk_dating_report_no_self',
  'chk_dating_min_age_18',
  'chk_dating_distance_bounds',
  'chk_dating_profile_adult',
  'chk_dating_message_content',
  'chk_dating_message_body_length',
  'enforce_dating_photo_limit',
  'trg_check_dating_photo_limit',
  'dating_message_participant_guard',
  'trg_dating_message_participant',
  'dating_photos_one_primary_per_profile',
] as const;

function migrationSqlFiles(): string[] {
  const dir = path.join(ROOT, 'prisma/migrations');
  return readdirSync(dir)
    .filter((entry) => entry !== 'migration_lock.toml')
    .map((entry) => path.join(dir, entry, 'migration.sql'))
    .sort();
}

function droppedWithoutCreate(sql: string, name: string): boolean {
  const dropped = new RegExp(
    `DROP\\s+(CONSTRAINT|INDEX|TRIGGER|FUNCTION)(?:\\s+IF\\s+EXISTS)?\\s+"?${name}"?`,
    'i',
  ).test(sql);
  if (!dropped) return false;
  const created = new RegExp(
    `(ADD\\s+CONSTRAINT|CREATE(?:\\s+UNIQUE)?\\s+INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?|CREATE\\s+TRIGGER|CREATE(?:\\s+OR\\s+REPLACE)?\\s+FUNCTION)\\s+"?${name}"?`,
    'i',
  ).test(sql);
  return !created;
}

/** Throws when a migration drops a dating protection or the canonical SQL lost one. */
export function assertDatingProtectionsIntact(): void {
  const files = migrationSqlFiles();
  const origin = files.find((file) =>
    file.includes('20261120120000_add_420_dating_module'),
  );
  if (!origin) throw new Error('Dating migration 20261120120000 is missing');
  const originSql = readFileSync(origin, 'utf8');
  const custom = readFileSync(
    path.join(ROOT, 'prisma/custom/420-dating-protections.sql'),
    'utf8',
  );
  for (const name of DATING_SQL_PROTECTIONS) {
    if (!originSql.includes(name)) {
      throw new Error(`Dating migration no longer creates ${name}`);
    }
    if (!custom.includes(name)) {
      throw new Error(
        `prisma/custom/420-dating-protections.sql no longer defines ${name}`,
      );
    }
    for (const file of files) {
      const sql = file === origin ? originSql : readFileSync(file, 'utf8');
      if (droppedWithoutCreate(sql, name)) {
        throw new Error(
          `${path.basename(path.dirname(file))} drops ${name} without recreating it`,
        );
      }
    }
  }
}
