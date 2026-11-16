import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorld, flat } from './helpers.js';
import { BoardStore, deepMerge, taskToDoc, docToTaskCols } from '../src/board/store.js';
import { BoardAuth, COOKIE } from '../src/board/auth.js';
import { boardRouter, preparePage, PAGE_TEXT } from '../src/board/routes.js';
import { makeApp } from '../src/app.js';
import { readFileSync } from 'node:fs';

async function boardWorld() {
  const w = await makeWorld();
  w.store = new BoardStore({ db: w.db, team: w.team, now: () => new Date('2026-11-16T03:00:00Z') });
  return w;
}

test('board store: tasks are the same rows the bot uses, both ways', async () => {
  const w = await boardWorld();
  const [t] = await w.team.createTasks([{ title: 'mockup กล่อง', owners: ['Bonnie'], due: '2026-11-20' }], 'Jai');
  const snap = await w.store.snapshot();
  assert.equal(snap.docs[`tasks/${t.id}`].title, 'mockup กล่อง');
  assert.equal(snap.docs[`tasks/${t.id}`].owner, 'Bonnie');

  // created on the board, with an alias and a field the Sheet has no column for
  await w.store.write({ op: 'set', path: 'tasks/web1', data: { title: 'ทำ deck', owner: 'บอนนี่, เจ', status: 'todo', due: '2026-11-25', priority: 'high', assigned: { Bonnie: 'x' } } }, { by: 'Non' });
  const row = await w.team.task('web1');
  assert.equal(row.owner, 'Bonnie, Jai', 'aliases become team nicknames');
  assert.equal(row.created_by, 'Non');
  assert.equal(row.source, 'board');
  assert.deepEqual(JSON.parse(row.extra), { assigned: { Bonnie: 'x' } });

  // bot bookkeeping survives a board edit; moving the date resets reminders; done stamps done_at
  await w.team.updateTask('web1', { reminded: 'r5:2026-11-25' });
  await w.store.write({ op: 'update', path: 'tasks/web1', data: { due: '2026-11-27' } });
  assert.equal((await w.team.task('web1')).reminded, '', 'reminders start again for the new date');
  await w.store.write({ op: 'update', path: 'tasks/web1', data: { status: 'done' } });
  assert.ok((await w.team.task('web1')).done_at);
  assert.equal((await w.store.get('tasks/web1')).assigned.Bonnie, 'x');

  await w.store.write({ op: 'delete', path: 'tasks/web1' });
  assert.equal(await w.team.task('web1'), null);
});

test('board store: other documents live in the Board tab; update deep-merges; long ones are split', async () => {
  const w = await boardWorld();
  await w.store.write({ op: 'set', path: 'bmc/main', data: { blocks: { segments: [{ id: 'a', text: 'นักวิ่ง' }] } } });
  await w.store.write({ op: 'update', path: 'bmc/main', data: { blocks: { channels: [{ id: 'b', text: 'ร้านกีฬา' }] } } });
  const bmc = await w.store.get('bmc/main');
  assert.deepEqual(Object.keys(bmc.blocks).sort(), ['channels', 'segments'], 'saving one block keeps the others');

  const big = 'ก'.repeat(100_000);
  await w.store.write({ op: 'set', path: 'sources/s1', data: { name: 'import', rows: [[big]] } });
  assert.equal((await w.db.all('Board')).filter((r) => r.path === 'sources/s1').length, 3, '100k chars -> 3 parts');
  assert.equal((await w.store.get('sources/s1')).rows[0][0].length, 100_000);
  await w.store.write({ op: 'set', path: 'sources/s1', data: { name: 'small' } });
  assert.equal((await w.db.all('Board')).filter((r) => r.path === 'sources/s1').length, 1, 'leftover parts cleared');

  await w.store.write({ op: 'set', path: 'milestones/m1', data: { title: 'Prototype ready', date: '2026-12-01', done: false } });
  assert.equal((await w.db.all('Milestones'))[0].title, 'Prototype ready');

  await assert.rejects(w.store.write({ op: 'set', path: '../x', data: {} }), /bad path/);
  await assert.rejects(w.store.write({ op: 'update', path: 'meta/none', data: { a: 1 } }), /not found/);
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] } }, { a: { c: [2] } }), { a: { b: 1, c: [2] } });
});

test('board store: Team page starts from the bot members; etag changes with data', async () => {
  const w = await boardWorld();
  const a = await w.store.snapshot();
  assert.deepEqual(Object.keys(a.docs).filter((p) => p.startsWith('contacts/')).map((p) => a.docs[p].nick), ['Jai', 'Best', 'Bonnie']);
  await w.store.write({ op: 'set', path: 'contacts/c1', data: { nick: 'Jai', email: 'x' } });
  const b = await w.store.snapshot();
  assert.notEqual(a.etag, b.etag);
  assert.deepEqual(Object.keys(b.docs).filter((p) => p.startsWith('contacts/')), ['contacts/c1'], 'once edited, the board list is used');
});

test('task mapping: Unassigned and notify convert; unknown fields go to extra', () => {
  const cols = docToTaskCols({ title: 'x', owner: 'Unassigned', notify: false, notified: { d5: false } });
  assert.equal(cols.owner, '');
  assert.equal(cols.notify, 'no');
  assert.equal(JSON.parse(cols.extra).notified.d5, false);
  const doc = taskToDoc({ title: 'x', owner: '', notify: 'yes', extra: '{"assigned":{"A":1}}' });
  assert.equal(doc.owner, 'Unassigned');
  assert.equal(doc.notify, true);
  assert.equal(doc.assigned.A, 1);
});

test('board auth: only linked members; signed cookie; tampering and expiry rejected', async () => {
  const w = await makeWorld();
  let now = Date.parse('2026-11-16T03:00:00Z');
  const auth = new BoardAuth({ secret: 's3cret', channelId: '123', team: w.team, now: () => now, verify: async (t) => ({ sub: t }) });
  await assert.rejects(auth.login('Ustranger'), (e) => e.status === 403);
  const { cookie, member } = await auth.login('Ubonnie');
  assert.equal(member.nickname, 'Bonnie');
  const req = (c) => ({ headers: { cookie: `${COOKIE}=${c}` } });
  assert.equal((await auth.member(req(cookie))).nickname, 'Bonnie');
  const [body, mac] = cookie.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'Ujai', nick: 'Jai', exp: now + 1e9 })).toString('base64url');
  assert.equal(await auth.member(req(`${forged}.${mac}`)), null, 'forged payload');
  assert.equal(await auth.member(req(`${body}.x${mac.slice(1)}`)), null, 'bad signature');
  now += 31 * 86400_000;
  assert.equal(await auth.member(req(cookie)), null, 'expired');
  const off = new BoardAuth({ secret: '', channelId: '', team: w.team });
  await assert.rejects(off.login('x'), (e) => e.status === 503);
});

test('page: LINE wording replaces email wording; our script loads before the dashboard script', () => {
  const real = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  const { html, missing } = preparePage(real, { liffId: '200-abc' });
  assert.deepEqual(missing, [], 'every replacement still matches the page');
  for (const [from] of PAGE_TEXT) assert.ok(!html.includes(from));
  assert.ok(html.indexOf('/board/client.js') < html.indexOf('window.claude && typeof window.claude.use'));
  assert.match(html, /"liffId":"200-abc"/);
});

async function serve(w, { verify = async (t) => ({ sub: t }) } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'board-'));
  writeFileSync(join(dir, 'index.html'), '<!DOCTYPE html><html><body>\n<script>\nwindow.page = 1;\n</script></body></html>');
  const auth = new BoardAuth({ secret: 's', channelId: 'c', team: w.team, verify });
  const changes = [];
  const board = boardRouter({
    store: w.store, auth, init: async () => {}, liffId: '1-x', pageFile: join(dir, 'index.html'),
    onChange: async (c) => { changes.push(c); await w.bot.boardChanged(c); },
  });
  const app = makeApp({ cfg: { ...w.cfg, line: { channelSecret: 'x', channelAccessToken: 't' } }, init: async () => {}, bot: w.bot, scheduler: w.scheduler, board });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body && JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let json = null;
    try { json = await r.json(); } catch { /* 304 / html */ }
    return { status: r.status, json, etag: r.headers.get('etag') };
  };
  return { base, call, changes, close: () => server.close(), logout: () => { cookie = ''; } };
}

test('board routes: page, sign-in, data with ETag, writes', async () => {
  const w = await boardWorld();
  const s = await serve(w);
  try {
    const page = await fetch(`${s.base}/board`).then((r) => r.text());
    assert.match(page, /src="\/board\/client\.js"/);
    assert.match(page, /static\.line-scdn\.net\/liff/);
    assert.equal((await s.call('/api/board/data')).status, 401, 'not signed in');
    assert.equal((await s.call('/api/board/login', { method: 'POST', body: { idToken: 'Ustranger' } })).status, 403);
    const login = await s.call('/api/board/login', { method: 'POST', body: { idToken: 'Ujai' } });
    assert.equal(login.status, 200);
    assert.deepEqual(login.json.member, { nickname: 'Jai', admin: true });
    const d1 = await s.call('/api/board/data');
    assert.equal(d1.status, 200);
    assert.equal((await s.call('/api/board/data', { headers: { 'if-none-match': d1.etag } })).status, 304, 'unchanged');
    const wr = await s.call('/api/board/write', { method: 'POST', body: { op: 'set', path: 'meta/sales', data: { target: 5000 } } });
    assert.equal(wr.status, 200);
    assert.equal(wr.json.doc.target, 5000);
    const d2 = await s.call('/api/board/data', { headers: { 'if-none-match': d1.etag } });
    assert.equal(d2.status, 200);
    assert.equal(d2.json.docs['meta/sales'].target, 5000);
    assert.equal((await s.call('/api/board/write', { method: 'POST', body: { op: 'nuke', path: 'meta/sales' } })).status, 400);
    s.logout();
    assert.equal((await s.call('/api/board/write', { method: 'POST', body: { op: 'delete', path: 'meta/sales' } })).status, 401);
  } finally { s.close(); }
});

test('board edits reach LINE: new owner gets a DM, done -> group ✓, blocked -> group 🚧 card', async () => {
  const w = await boardWorld();
  const s = await serve(w);
  try {
    await s.call('/api/board/login', { method: 'POST', body: { idToken: 'Ujai' } });
    const pushes = () => w.client.pushes.length;
    await s.call('/api/board/write', { method: 'POST', body: { op: 'set', path: 'tasks/b1', data: { title: 'ถ่ายรูปสินค้า', owner: 'Bonnie', status: 'todo', due: '2026-11-20' } } });
    const dm = w.client.pushes.at(-1);
    assert.equal(dm.to, 'Ubonnie', 'Bonnie told in a private chat');
    assert.match(flat(dm), /Jai มอบงานใหม่ให้ 1 งาน/);
    assert.match(flat(dm), /ถ่ายรูปสินค้า/);
    assert.match((await w.team.task('b1')).reminded, /a:Bonnie/, 'morning digest will not repeat it');

    const n = pushes();
    await s.call('/api/board/write', { method: 'POST', body: { op: 'update', path: 'tasks/b1', data: { title: 'ถ่ายรูปสินค้า v2' } } });
    assert.equal(pushes(), n, 'no new owner, no message');

    await s.call('/api/board/write', { method: 'POST', body: { op: 'update', path: 'tasks/b1', data: { status: 'blocked', blocker: 'กล้องเสีย' } } });
    const card = w.client.pushes.at(-1);
    assert.equal(card.to, 'Cteam');
    assert.match(card.messages[0].altText, /🚧 ติดอยู่: ถ่ายรูปสินค้า v2 · Bonnie ติดงานนี้/);

    await s.call('/api/board/write', { method: 'POST', body: { op: 'update', path: 'tasks/b1', data: { status: 'done' } } });
    assert.deepEqual(await w.db.kvGet('group_notices'), ['✓ Bonnie · ถ่ายรูปสินค้า v2']);
    assert.equal(s.changes.length, 4);
  } finally { s.close(); }
});

test('"บอร์ด" in chat or group gives a button that opens the board in LINE', async () => {
  const w = await makeWorld();
  assert.match(flat(await w.dm('Jai', 'บอร์ด')), /ยังไม่ได้เปิดใช้บอร์ด/, 'no LIFF yet');
  w.bot.cfg = { ...w.cfg, board: { liffId: '2001-Ab' } };
  const r = await w.say('Non' in w.uid ? 'Non' : 'Best', 'แดชบอร์ด');
  assert.match(flat(r), /"uri":"https:\/\/liff\.line\.me\/2001-Ab"/);
});

test('brand: the NORSE wordmark replaces the sidebar text; favicon and logo files are served', async () => {
  const real = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  const logoSvg = readFileSync(new URL('../brand/norse-logo.svg', import.meta.url), 'utf8');
  const { html, missing } = preparePage(real, { liffId: 'x', logoSvg });
  assert.deepEqual(missing, []);
  assert.ok(!html.includes('<b>NORSE</b></div>'));
  assert.match(html, /<b class="norse-wm"><svg [^>]*aria-label="NORSE"/);
  assert.match(html, /<link rel="icon" href="\/brand\/icon\.svg"/);
  const w = await boardWorld();
  const s = await serve(w);
  try {
    const r = await fetch(`${s.base}/brand/icon.svg`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /svg/);
    assert.equal((await fetch(`${s.base}/brand/line-profile.png`)).status, 200);
  } finally { s.close(); }
});
