import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('M12-P02-T03 backend .env gitignore', () => {
  it('ignores .env and .env.* and keeps .env.example', () => {
    const gitignore = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.gitignore'),
      'utf8',
    );
    assert.match(gitignore, /^\.env$/m);
    assert.match(gitignore, /^\.env\.\*$/m);
    assert.match(gitignore, /^!\.env\.example$/m);
  });
});