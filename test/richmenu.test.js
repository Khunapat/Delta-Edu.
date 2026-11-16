import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { areas, richMenuBody, BUTTONS, MENU_SIZE, NEW_TASK_PREFIX } from '../src/richmenu.js';
import { command } from '../src/rules.js';
import { makeWorld, flat } from './helpers.js';

test('menu bar: six tap areas cover the whole image with no gaps or overlaps', () => {
  const a = areas();
  assert.equal(a.length, 6);
  let total = 0;
  for (const r of a) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= MENU_SIZE.width && r.y + r.height <= MENU_SIZE.height);
    total += r.width * r.height;
  }
  assert.equal(total, MENU_SIZE.width * MENU_SIZE.height);
  const body = richMenuBody('abc12345');
  assert.equal(body.name, 'norse-main-abc12345');
  assert.ok(body.chatBarText.length <= 14, 'LINE limit');
  assert.equal(body.areas.length, BUTTONS.length);
});

test('menu bar: every button is a command the bot knows (no AI) or the keyboard opener', () => {
  for (const b of BUTTONS) {
    assert.ok(b.action.label.length <= 20, `${b.key} label too long for LINE`);
    if (b.action.type === 'message') assert.ok(command(b.action.text), `${b.action.text} is not a command`);
    else assert.deepEqual([b.action.data, b.action.inputOption, b.action.fillInText], ['a=kbd', 'openKeyboard', NEW_TASK_PREFIX]);
  }
});

test('menu bar image: 2500 x 843 PNG under 1 MB', () => {
  const file = new URL('../scripts/rich-menu/menu.png', import.meta.url);
  const png = readFileSync(file);
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [MENU_SIZE.width, MENU_SIZE.height]);
  assert.ok(statSync(file).size < 1024 * 1024);
});

test('เพิ่มงาน: the tap gets no reply; "งานใหม่: ..." always creates, never updates', async () => {
  const w = await makeWorld();
  const [t] = await w.team.createTasks([{ title: 'deck นำเสนอ', owners: ['Jai'], due: '2026-11-20' }], 'Jai');
  const before = w.client.replies.length;
  await w.tap('Jai', 'a=kbd');
  await w.tap('Ustranger', 'a=kbd');
  assert.equal(w.client.replies.length, before, 'no reply to the button itself');

  assert.match(flat(await w.dm('Jai', 'งานใหม่:')), /งานอะไร/);
  w.provider.next({ intent: 'create_tasks', tasks: [{ title: 'ทำ deck ให้เสร็จ', owners: ['@me'], due_text: 'ศุกร์', due_date: '2026-11-20', stream: '', priority: 'med' }] });
  assert.match(flat(await w.dm('Jai', 'งานใหม่: ทำ deck ให้เสร็จก่อนศุกร์')), /ยืนยัน/);
  assert.equal(w.provider.calls.length, 1, 'went to the AI as a new task');
  assert.equal((await w.team.task(t.id)).status, 'todo', '"เสร็จ" in a new task did not close an old one');
});

test('scripts/rich-menu.js: creates once, skips when unchanged, replaces old Norse menus only', async () => {
  const { execFile } = await import('node:child_process');
  const { createServer } = await import('node:http');
  const menus = new Map([['old1', { richMenuId: 'old1', name: 'norse-main-00000000' }], ['other', { richMenuId: 'other', name: 'someone-else' }]]);
  let def = 'old1';
  let n = 0;
  const calls = [];
  const server = createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      body = Buffer.concat(body);
      calls.push(`${req.method} ${req.url}`);
      const send = (code, obj = {}) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== 'Bearer tok') return send(401);
      if (req.method === 'GET' && req.url === '/richmenu/list') return send(200, { richmenus: [...menus.values()] });
      if (req.method === 'GET' && req.url === '/user/all/richmenu') return def ? send(200, { richMenuId: def }) : send(404);
      if (req.method === 'POST' && req.url === '/richmenu') { const id = `new${++n}`; menus.set(id, { richMenuId: id, name: JSON.parse(body).name }); return send(200, { richMenuId: id }); }
      if (req.method === 'POST' && /^\/data\/richmenu\/.+\/content$/.test(req.url)) return send(body.length > 1000 ? 200 : 400);
      let m = /^\/user\/all\/richmenu\/(.+)$/.exec(req.url);
      if (req.method === 'POST' && m) { def = m[1]; return send(200); }
      m = /^\/richmenu\/(.+)$/.exec(req.url);
      if (req.method === 'DELETE' && m) { menus.delete(m[1]); return send(200); }
      return send(404);
    });
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = () => new Promise((resolve) => execFile(process.execPath, ['scripts/rich-menu.js'], {
    env: { ...process.env, LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_API_BASE: base, LINE_DATA_API_BASE: `${base}/data` },
  }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr })));
  try {
    let r = await run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /menu bar set/);
    assert.equal(def, 'new1');
    assert.deepEqual([...menus.keys()].sort(), ['new1', 'other'], 'old Norse menu deleted, other menus kept');
    r = await run();
    assert.match(r.out, /already up to date/);
    assert.equal(n, 1, 'nothing new created');
  } finally { server.close(); }
});
