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
const BRAND = join(ROOT, '..', 'brand');

// Text swaps for the page (it is written for LINE already, so none are needed now;
// kept so a future page from elsewhere can be adapted without code changes).
export const PAGE_TEXT = [];

const LOGO_AT = '<b>DELTA_EDU</b></div>';
const LOGO_CSS = '<link rel="icon" href="/brand/icon.svg" type="image/svg+xml">\n'
  + '<style>.logo b.delta-wm{display:flex;align-items:center;line-height:0}.logo b.delta-wm svg{height:20px;width:auto}</style>\n';

/**
 * The board HTML with our runtime added before its own script, and the δelta Edu.
 * wordmark (brand/delta-logo.svg) in the sidebar.
 */
export function preparePage(html, { liffId = '', logoSvg = '' } = {}) {
  const missing = [];
  for (const [from, to] of PAGE_TEXT) {
    if (html.includes(from)) html = html.split(from).join(to);
    else missing.push(from.slice(0, 50));
  }
  if (logoSvg) {
    if (html.includes(LOGO_AT)) html = html.replace(LOGO_AT, `<b class="delta-wm">${logoSvg.trim()}</b></div>`);
    else missing.push(LOGO_AT);
    html = html.replace('</head>', LOGO_CSS + '</head>');
  }
  const inject = `<script>window.DELTA_BOARD=${JSON.stringify({ liffId })};</script>\n`
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
    const logoSvg = existsSync(join(BRAND, 'delta-logo.svg')) ? readFileSync(join(BRAND, 'delta-logo.svg'), 'utf8') : '';
    const out = preparePage(readFileSync(pageFile, 'utf8'), { liffId, logoSvg });
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
    try { await init(); next(); } catch (err) { console.error('board init failed', err?.message || err); res.status(503).json({ error: "Can't open the Sheet yet. Try again in a minute." }); }
  });

  api.post('/login', async (req, res) => {
    try {
      const { cookie, member } = await auth.login(req.body?.idToken);
      res.set('Set-Cookie', auth.cookieHeader(cookie)).json({ member: publicMember(member) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Sign-in failed' });
    }
  });
  api.post('/logout', (_req, res) => res.set('Set-Cookie', auth.cookieHeader('', { clear: true })).json({ ok: true }));

  const signedIn = async (req, res, next) => {
    const member = await auth.member(req).catch(() => null);
    if (!member) return res.status(401).json({ error: 'Not signed in' });
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
      res.status(500).json({ error: 'Could not read the data' });
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
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not save' });
    }
  });

  r.use('/api/board', api);
  return r;
}

const publicMember = (m) => ({ nickname: m.nickname, admin: !!m.admin });
