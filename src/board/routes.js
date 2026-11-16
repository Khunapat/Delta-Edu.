// HTTP routes for the web board (the team dashboard, hosted next to the bot).
//
//   GET  /board              the dashboard page, with board/client.js added
//   GET  /board/client.js    stand-in for the old artifact runtime (db + user)
//   POST /api/board/login    LIFF ID token -> session cookie (team members only)
//   GET  /api/board/me       who am I (401 when not signed in)
//   GET  /api/board/data     every document, with an ETag (304 when unchanged)
//   POST /api/board/write    { op: set|update|delete, path, data }

import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'board');

// The page was written for claude.ai and emails. Here, people are told in LINE.
export const PAGE_TEXT = [
  ['" แล้ว · จะส่งอีเมลแจ้ง"', '" แล้ว · Norse จะแจ้งใน LINE"'],
  ['"Task added · จะส่งอีเมลแจ้งผู้รับผิดชอบ"', '"Task added · Norse แจ้งผู้รับผิดชอบใน LINE"'],
  ['"คนที่ถูกเพิ่มใหม่จะได้อีเมลแจ้งจาก NORSE ว่ามีงานนี้ในรอบส่งถัดไป ส่วนอีเมลเตือนก่อนครบกำหนด (5, 3, 1 วัน) เปิดได้ที่ช่อง Email reminders"',
    '"คนที่ถูกเพิ่มจะได้ข้อความจาก Norse ใน LINE (วันละไม่เกิน 1 ครั้ง) และทุกงานมีเตือนก่อนครบกำหนด 5, 3, 1 วัน"'],
  ['"ไม่มีอีเมลในหน้า Team"', '""'],
  ['"✉️ คนที่เพิ่มใหม่จะได้อีเมลแจ้งจาก NORSE ว่ามีงานนี้ (ส่งรอบถัดไป ภายในประมาณ 1 ชั่วโมง)"', '"💬 คนที่เพิ่มใหม่จะได้ข้อความจาก Norse ใน LINE"'],
  ['field("Email reminders",iNotify), ', ''],
  ['"🔔 Email reminders: new, 5, 3, 1 days before"', '"🔔 LINE reminders"'],
  ['"Sign in to claude.ai with access to this board to see your team\'s tasks."', '"เปิดบอร์ดจากเมนู Norse ใน LINE เพื่อเข้าสู่ระบบ"'],
];

/** The dashboard HTML with our runtime added before its own script, and email wording swapped for LINE. */
export function preparePage(html, { liffId = '' } = {}) {
  const missing = [];
  for (const [from, to] of PAGE_TEXT) {
    if (html.includes(from)) html = html.split(from).join(to);
    else missing.push(from.slice(0, 50));
  }
  const inject = `<script>window.NORSE_BOARD=${JSON.stringify({ liffId })};</script>\n`
    + (liffId ? '<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>\n' : '')
    + '<script src="/board/client.js"></script>\n';
  const at = html.indexOf('\n<script>');
  if (at < 0) throw new Error('board page: no main <script> found');
  return { html: html.slice(0, at + 1) + inject + html.slice(at + 1), missing };
}

export function boardRouter({ store, auth, init, onChange = async () => {}, liffId = '', pageFile = join(ROOT, 'index.html') }) {
  const r = express.Router();
  let page = null;
  const loadPage = () => {
    if (page) return page;
    if (!existsSync(pageFile)) return null;
    const out = preparePage(readFileSync(pageFile, 'utf8'), { liffId });
    if (out.missing.length) console.warn('board page: text not found (page changed?):', out.missing.join(' | '));
    page = out.html;
    return page;
  };
  const client = readFileSync(join(ROOT, 'client.js'), 'utf8');

  r.get('/board', (_req, res) => {
    const html = loadPage();
    if (!html) return res.status(404).send('board page missing');
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  });
  r.get('/board/client.js', (_req, res) => res.set('Cache-Control', 'no-cache').type('application/javascript').send(client));

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(async (_req, res, next) => {
    try { await init(); next(); } catch (err) { console.error('board init failed', err?.message || err); res.status(503).json({ error: 'ระบบยังเปิดชีตไม่ได้ ลองใหม่อีกสักครู่' }); }
  });

  api.post('/login', async (req, res) => {
    try {
      const { cookie, member } = await auth.login(req.body?.idToken);
      res.set('Set-Cookie', auth.cookieHeader(cookie)).json({ member: publicMember(member) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.status ? err.message : 'เข้าสู่ระบบไม่สำเร็จ' });
    }
  });
  api.post('/logout', (_req, res) => res.set('Set-Cookie', auth.cookieHeader('', { clear: true })).json({ ok: true }));

  const signedIn = async (req, res, next) => {
    const member = await auth.member(req).catch(() => null);
    if (!member) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ' });
    req.member = member;
    next();
  };

  api.get('/me', signedIn, (req, res) => res.json({ member: publicMember(req.member) }));

  api.get('/data', signedIn, async (req, res) => {
    try {
      const { docs, etag } = await store.snapshot();
      const tag = `"${etag}"`;
      res.set('ETag', tag).set('Cache-Control', 'no-cache');
      if (req.get('if-none-match') === tag) return res.status(304).end();
      res.json({ docs, etag });
    } catch (err) {
      console.error('board data failed', err?.message || err);
      res.status(500).json({ error: 'อ่านข้อมูลไม่สำเร็จ' });
    }
  });

  api.post('/write', signedIn, async (req, res) => {
    const { op, path, data } = req.body || {};
    try {
      const out = await store.write({ op, path, data }, { by: req.member.nickname });
      // Before replying: Cloud Run may pause the CPU once the response is sent.
      await onChange({ path, ...out, member: req.member }).catch((err) => console.warn('board change hook failed', err?.message || err));
      res.json({ ok: true, doc: out.after });
    } catch (err) {
      if (!err.status) console.error('board write failed', err?.message || err);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'บันทึกไม่สำเร็จ' });
    }
  });

  r.use('/api/board', api);
  return r;
}

const publicMember = (m) => ({ nickname: m.nickname, admin: !!m.admin });
