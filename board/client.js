// Runs in the browser before the dashboard's own script. The dashboard was built for
// claude.ai and asks for window.claude.use("db") / use("user"); this gives it the same
// small interface, backed by the Norse server and the team Sheet:
//   db.collection(name).onSnapshot / add / doc(id)      db.doc(path).onSnapshot / get / set / update / delete
// Sign-in is LINE (LIFF). Only team members linked to Norse get in.
(function () {
  'use strict';
  const CFG = window.NORSE_BOARD || {};
  const POLL_MS = 8000;
  let docs = {};            // path -> data
  let etag = '';
  let pending = 0;
  let me = null;
  let polling = null;
  const listeners = new Set();

  // ---------- small helpers ----------
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const newId = () => {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const b = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(b, (x) => a[x % a.length]).join('');
  };
  const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  function deepMerge(base, patch) {
    const out = Object.assign({}, base || {});
    for (const k of Object.keys(patch || {})) out[k] = isPlain(patch[k]) && isPlain(out[k]) ? deepMerge(out[k], patch[k]) : patch[k];
    return out;
  }
  async function http(url, opts) {
    const r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    let body = null;
    if (r.status !== 304) { try { body = await r.json(); } catch (_) { body = null; } }
    return { status: r.status, ok: r.ok, body, etag: r.headers.get('ETag') };
  }

  // ---------- full-screen message (sign-in problems) ----------
  function overlay(title, text, { button } = {}) {
    let el = document.getElementById('norse-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'norse-overlay';
      el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#0C1112;color:#E7EFED;'
        + 'font-family:"Noto Sans Thai","DM Sans",system-ui,sans-serif;padding:24px';
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'max-width:420px;width:100%;background:#141B1D;border:1px solid #232E31;border-radius:20px;padding:28px;text-align:center';
    const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:10px';
    const p = document.createElement('div'); p.textContent = text; p.style.cssText = 'font-size:15px;color:#8C9A98;line-height:1.6';
    card.append(h, p);
    if (button) {
      const a = document.createElement('a'); a.textContent = button.label; a.href = button.href;
      a.style.cssText = 'display:inline-block;margin-top:18px;background:#8FD9C6;color:#0C1715;font-weight:700;border-radius:999px;padding:10px 22px;text-decoration:none';
      card.append(a);
    }
    el.append(card);
  }
  const openInLine = () => (CFG.liffId ? { label: 'เปิดใน LINE', href: 'https://liff.line.me/' + CFG.liffId } : null);

  // ---------- sign-in ----------
  async function signIn() {
    const r = await http('/api/board/me');
    if (r.ok) return r.body.member;
    if (!CFG.liffId || !window.liff) {
      overlay('ยังเปิดบอร์ดไม่ได้', 'ยังไม่ได้ตั้งค่า LINE Login ของบอร์ด (LIFF) ให้ admin ทำตามขั้นตอนใน README');
      return null;
    }
    await window.liff.init({ liffId: CFG.liffId });
    if (!window.liff.isLoggedIn()) {
      window.liff.login({ redirectUri: location.href });
      return new Promise(() => {}); // leaving the page
    }
    const login = await http('/api/board/login', { method: 'POST', body: JSON.stringify({ idToken: window.liff.getIDToken() }) });
    if (login.ok) return login.body.member;
    if (login.status === 401 && !sessionStorage.getItem('norse-relogin')) {
      // The LINE token was stale: sign in again once.
      sessionStorage.setItem('norse-relogin', '1');
      window.liff.logout();
      window.liff.login({ redirectUri: location.href });
      return new Promise(() => {});
    }
    overlay('เข้าบอร์ดไม่ได้', (login.body && login.body.error) || 'เข้าสู่ระบบไม่สำเร็จ', { button: openInLine() });
    return null;
  }

  // ---------- data ----------
  function docSnap(path) {
    const d = docs[path];
    return {
      id: path.split('/')[1], ref: { path, id: path.split('/')[1] }, exists: d != null,
      data: () => clone(d), metadata: { fromCache: false, hasPendingWrites: pending > 0 },
    };
  }
  function collSnap(coll, changed) {
    const list = Object.keys(docs).filter((p) => p.split('/')[0] === coll).sort().map(docSnap);
    const changes = [...(changed || [])].filter((p) => p.split('/')[0] === coll).map((p) => ({ type: docs[p] == null ? 'removed' : 'modified', doc: docSnap(p) }));
    return {
      docs: list, size: list.length, empty: !list.length, forEach: (fn) => list.forEach(fn),
      metadata: { fromCache: false, hasPendingWrites: pending > 0 }, docChanges: () => changes,
    };
  }
  function fire(l, changed) {
    try { l.cb(l.kind === 'doc' ? docSnap(l.key) : collSnap(l.key, changed)); } catch (err) { console.error(err); }
  }
  function setDocs(next) {
    const changed = new Set();
    for (const p of new Set([...Object.keys(docs), ...Object.keys(next)])) {
      if (JSON.stringify(docs[p]) !== JSON.stringify(next[p])) changed.add(p);
    }
    docs = next;
    if (!changed.size) return;
    for (const l of listeners) {
      const hit = l.kind === 'doc' ? changed.has(l.key) : [...changed].some((p) => p.split('/')[0] === l.key);
      if (hit) fire(l, changed);
    }
  }
  function listen(kind, key, cb, err) {
    const l = { kind, key, cb, err };
    listeners.add(l);
    setTimeout(() => listeners.has(l) && fire(l, new Set()), 0); // first snapshot, like the original
    return () => listeners.delete(l);
  }
  async function load() {
    const r = await http('/api/board/data', { headers: etag ? { 'If-None-Match': '"' + etag + '"' } : {} });
    if (r.status === 304) return true;
    if (r.status === 401) {
      stopPolling();
      overlay('หมดเวลาเข้าสู่ระบบ', 'เปิดบอร์ดใหม่จากเมนู Norse ใน LINE', { button: openInLine() });
      for (const l of listeners) l.err && l.err({ code: 'revoked' });
      return false;
    }
    if (!r.ok) return false;
    etag = r.body.etag;
    if (!pending) setDocs(r.body.docs || {});
    return true;
  }
  function startPolling() {
    stopPolling();
    polling = setInterval(() => { if (!document.hidden && !pending) load().catch(() => {}); }, POLL_MS);
  }
  function stopPolling() { if (polling) clearInterval(polling); polling = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && polling) load().catch(() => {}); });

  async function write(op, path, data) {
    const before = docs[path];
    const next = Object.assign({}, docs);
    if (op === 'delete') delete next[path];
    else next[path] = op === 'update' ? deepMerge(before, data) : clone(data);
    pending++;
    setDocs(next); // show it now
    try {
      const r = await http('/api/board/write', { method: 'POST', body: JSON.stringify({ op, path, data }) });
      if (!r.ok) throw Object.assign(new Error((r.body && r.body.error) || 'บันทึกไม่สำเร็จ'), { code: r.status === 401 ? 'revoked' : 'failed' });
    } finally {
      pending--;
      etag = '';
      await load().catch(() => {});
    }
  }

  const docRef = (path) => ({
    id: path.split('/')[1], path,
    onSnapshot: (cb, err) => listen('doc', path, cb, err),
    get: async () => docSnap(path),
    set: (data, opts) => write(opts && opts.merge && docs[path] ? 'update' : 'set', path, data),
    update: (data) => write('update', path, data),
    delete: () => write('delete', path),
  });
  const collRef = (name) => ({
    id: name,
    doc: (id) => docRef(name + '/' + (id || newId())),
    add: async (data) => { const ref = docRef(name + '/' + newId()); await ref.set(data); return ref; },
    onSnapshot: (cb, err) => listen('coll', name, cb, err),
    get: async () => collSnap(name),
  });
  const db = { collection: collRef, doc: (path) => docRef(path) };

  let ready = null;
  function connect() {
    ready ||= (async () => {
      try {
        me = await signIn();
        if (!me) return null;
        if (!(await load())) return null;
        startPolling();
        return db;
      } catch (err) {
        console.error(err);
        overlay('เปิดบอร์ดไม่ได้', 'เชื่อมต่อไม่สำเร็จ ลองเปิดใหม่อีกครั้ง', { button: openInLine() });
        return null;
      }
    })();
    return ready;
  }

  window.claude = Object.assign(window.claude || {}, {
    use: async (name) => {
      if (name === 'db') return connect();
      if (name === 'user') {
        await connect();
        return me ? { can: async () => true, me: async () => ({ name: me.nickname }) } : null;
      }
      return null;
    },
  });
})();
