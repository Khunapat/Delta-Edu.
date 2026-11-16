import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../src/flex.js';
import { samples } from '../scripts/cards/samples.mjs';
import { makeApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const walk = (n, fn) => { if (n && typeof n === 'object') { fn(n); for (const v of Object.values(n)) walk(v, fn); } };

test('banners appear only when the public https address is known', () => {
  F.setAssetBase('');
  const plain = F.digestMessages({ greeting: 'อรุณสวัสดิ์', today: '2026-11-16', sections: [], actionable: [] })[0];
  assert.equal(plain.contents.hero, undefined);
  assert.ok(plain.contents.header, 'gradient header instead');
  F.setAssetBase('https://norse-bot-abc.a.run.app', 'v9');
  const withPic = F.digestMessages({ greeting: 'อรุณสวัสดิ์', today: '2026-11-16', sections: [], actionable: [] })[0];
  assert.deepEqual(
    [withPic.contents.hero.type, withPic.contents.hero.animated, withPic.contents.hero.url],
    ['image', true, 'https://norse-bot-abc.a.run.app/brand/banner-morning.png?v=v9'],
  );
  assert.equal(withPic.contents.header, undefined, 'title moves under the banner');
  F.setAssetBase('');
});

test('every card fits LINE limits: alt text, bubble size, https images, button labels', () => {
  F.setAssetBase('https://norse-bot-abc.a.run.app', 'v1');
  for (const s of samples()) {
    for (const m of s.messages.flat()) {
      if (m.type !== 'flex') continue;
      assert.ok(m.altText.length <= 400, `${s.id}: alt text too long`);
      const bubbles = m.contents.type === 'carousel' ? m.contents.contents : [m.contents];
      assert.ok(bubbles.length <= 12, `${s.id}: carousel too long`);
      for (const b of bubbles) assert.ok(JSON.stringify(b).length < 30_000, `${s.id}: bubble over 30 KB`);
      assert.ok(JSON.stringify(m.contents).length < 50_000, `${s.id}: message over 50 KB`);
      walk(m.contents, (n) => {
        if (n.type === 'image') assert.match(n.url, /^https:\/\//, `${s.id}: image must be https`);
        if (n.action?.label) assert.ok(n.action.label.length <= 20, `${s.id}: label "${n.action.label}" over 20`);
        if (n.type === 'box' && n.width && /px$/.test(n.width) && n.flex === undefined && n.position !== 'absolute') {
          // fixed-width boxes must say flex 0, or LINE may stretch them
          assert.fail(`${s.id}: fixed-width box without flex: 0`);
        }
      });
    }
  }
  F.setAssetBase('');
});

test('banner files exist, are animated PNGs and under LINE\'s 300 KB', () => {
  for (const name of F.BANNERS) {
    const buf = readFileSync(new URL(`../brand/banner-${name}.png`, import.meta.url));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG');
    assert.ok(buf.includes(Buffer.from('acTL')), `${name} is animated`);
    assert.ok(buf.length < 300 * 1024, `${name} under 300 KB`);
  }
});

test('server learns its public address from Cloud Run requests and serves the banners', async () => {
  F.setAssetBase('');
  const cfg = loadConfig({ LINE_CHANNEL_SECRET: 'x' });
  const app = makeApp({ cfg, init: async () => {}, bot: {}, scheduler: {} });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(base + '/', { headers: { host: 'localhost' } });
    assert.equal(F.assetBase(), '', 'not from a local host');
    await fetch(base + '/', { headers: { 'x-forwarded-host': 'norse-bot-abc.a.run.app' } });
    assert.equal(F.assetBase(), 'https://norse-bot-abc.a.run.app');
    const r = await fetch(base + '/brand/banner-done.png');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /png/);
  } finally { server.close(); F.setAssetBase(''); }
});
