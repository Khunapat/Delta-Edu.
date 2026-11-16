// Who is looking at the web board. Team only, same rule as the bot:
//   1. The page (inside LINE, via LIFF) gets a LINE ID token for the user.
//   2. We ask LINE to verify it for our LINE Login channel (same provider as the bot,
//      so the user id is the same one the bot stored in Members.line_user_id).
//   3. Only a linked member gets a session: a signed cookie, 30 days.
// Every API call checks the cookie AND that the person is still linked.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'norse_board';
const DAY = 86400_000;

export class BoardAuth {
  constructor({ secret, channelId, team, ttlDays = 30, now = () => Date.now(), verify = null }) {
    this.secret = secret || '';
    this.channelId = channelId || '';
    this.team = team;
    this.ttl = ttlDays * DAY;
    this.now = now;
    this.verifyToken = verify || ((idToken) => verifyWithLine(idToken, this.channelId));
  }

  get ready() { return !!(this.secret && this.channelId); }

  sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  read(cookie) {
    if (!cookie || !this.secret) return null;
    const [body, mac] = String(cookie).split('.');
    if (!body || !mac) return null;
    const want = createHmac('sha256', this.secret).update(body).digest();
    const got = Buffer.from(mac, 'base64url');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString());
      return p && p.exp > this.now() ? p : null;
    } catch { return null; }
  }

  /** ID token from LIFF -> { cookie, member } or throws with a status and a Thai message. */
  async login(idToken) {
    if (!this.ready) throw err(503, 'ยังไม่ได้ตั้งค่า LINE Login ของบอร์ด');
    if (!idToken) throw err(400, 'ไม่มี token จาก LINE');
    const claims = await this.verifyToken(idToken);
    const member = await this.team.memberByUserId(claims?.sub);
    if (!member) throw err(403, 'บอร์ดนี้ใช้ได้เฉพาะทีม NORSE ที่เชื่อม LINE กับ Norse แล้ว (พิมพ์ "ฉันคือ <ชื่อเล่น>" ในแชทกับ Norse ก่อน)');
    const cookie = this.sign({ uid: member.line_user_id, nick: member.nickname, exp: this.now() + this.ttl });
    return { cookie, member };
  }

  /** Session from the request cookie, still a linked member -> member, else null. */
  async member(req) {
    const p = this.read(cookieValue(req.headers.cookie, COOKIE));
    if (!p) return null;
    return (await this.team.memberByUserId(p.uid)) || null;
  }

  cookieHeader(value, { clear = false } = {}) {
    const attrs = ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', `Max-Age=${clear ? 0 : Math.floor(this.ttl / 1000)}`];
    return `${COOKIE}=${clear ? '' : value}; ${attrs.join('; ')}`;
  }
}

export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/** https://developers.line.biz/en/reference/line-login/#verify-id-token */
async function verifyWithLine(idToken, channelId) {
  const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.sub) throw err(401, 'LINE ยืนยันตัวตนไม่ผ่าน ลองเปิดบอร์ดใหม่');
  return body;
}

const err = (status, message) => Object.assign(new Error(message), { status });
