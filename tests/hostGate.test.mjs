import test from 'node:test';
import assert from 'node:assert/strict';
import { isGatePage, gateFetch } from '../src/api/hostGate.js';

const GATE = '<html><body><script type="text/javascript" src="/aes.js" ></script><script>function toNumbers(d){} var a=toNumbers("f6");document.cookie="__test="+toHex(slowAES.decrypt(c,2,a,b));location.href="https://codeadifference.ct.ws/api/ai.php?i=1";</script></body></html>';

test('the host check page is recognised; real answers are not', () => {
  assert.equal(isGatePage('text/html', GATE), true);
  assert.equal(isGatePage('application/json; charset=utf-8', '{"ok":true,"text":"slowAES"}'), false);
  assert.equal(isGatePage('text/html', '<html><body>LOCK IN!</body></html>'), false);
});

test('gateFetch retries once after the check page, and passes real answers straight through', async () => {
  const calls = [];
  const replies = [
    new Response(GATE, { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{"ok":true,"text":"Mars"}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push([url, opts?.method]); return replies.shift(); };
  try {
    const r = await gateFetch('/api/ai.php', { method: 'POST' });   // no document in Node: renewal is skipped, the retry still happens
    assert.deepEqual(await r.json(), { ok: true, text: 'Mars' });
    assert.equal(calls.length, 2);

    calls.length = 0;
    replies.push(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    await gateFetch('/api/ai.php', { method: 'POST' });
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = realFetch; }
});
