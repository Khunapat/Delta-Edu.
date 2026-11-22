// scripts/setup.sh must never deploy over the Norse bot, which lives in the same
// Google Cloud account. The guard runs before anything touches gcloud.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const script = readFileSync(join(root, 'scripts/setup.sh'), 'utf8');

/** A copy of the repo bits setup.sh reads; SETUP_GUARD_ONLY makes it stop right after the guard. */
function sandbox({ pkgName = 'delta-edu-bot', env = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'setup-'));
  mkdirSync(join(dir, 'scripts'));
  cpSync(join(root, 'scripts/setup.sh'), join(dir, 'scripts/setup.sh'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkgName }, null, 2));
  if (env) writeFileSync(join(dir, '.env'), env);
  return dir;
}
const run = (dir, extraEnv = {}) => spawnSync('bash', [join(dir, 'scripts/setup.sh')], {
  encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir, SETUP_GUARD_ONLY: '1', ...extraEnv },
});

test('setup: the default service is delta-edu-bot, never norse-bot', () => {
  assert.match(script, /SERVICE="\$\{SERVICE:-delta-edu-bot\}"/);
  assert.doesNotMatch(script, /SERVICE:-norse/);
  assert.match(script, /setenv BOT_NAME "Delta"/);
});

test('setup: SERVICE=norse-bot is refused before gcloud is touched', () => {
  const r = run(sandbox(), { SERVICE: 'norse-bot' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Norse bot/);
});

test('setup: refuses to run from the Norse folder or with the Norse .env', () => {
  let r = run(sandbox({ pkgName: 'norse-bot' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not the Delta Edu bot/);
  r = run(sandbox({ env: 'BOT_NAME=Norse\n' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Norse settings file/);
});

test('setup: in the Delta Edu folder the guard passes', () => {
  const r = run(sandbox({ env: 'BOT_NAME=Delta\n' }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /guard ok: delta-edu-bot/);
});
