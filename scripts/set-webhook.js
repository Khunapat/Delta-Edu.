// Point the LINE channel's webhook at the bot and ask LINE to test it.
//   LINE_CHANNEL_ACCESS_TOKEN=... node scripts/set-webhook.js https://<service>/webhook

const url = process.argv[2];
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!url || !token) {
  console.error('usage: LINE_CHANNEL_ACCESS_TOKEN=... node scripts/set-webhook.js <https://.../webhook>');
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const put = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
  method: 'PUT', headers, body: JSON.stringify({ endpoint: url }),
});
if (!put.ok) {
  console.error('could not set webhook:', put.status, await put.text());
  process.exit(1);
}
console.log('   webhook set:', url);
const test = await fetch('https://api.line.me/v2/bot/channel/webhook/test', { method: 'POST', headers, body: JSON.stringify({ endpoint: url }) });
const r = await test.json().catch(() => ({}));
console.log(r.success ? '   ✓ LINE reached the bot' : `   LINE test: ${r.statusCode || test.status} ${r.reason || ''} ${r.detail || ''}`);
