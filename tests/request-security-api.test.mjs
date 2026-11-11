import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';

const origin = 'http://127.0.0.1:3246';
test('API middleware rejects forged browser mutations before authentication or database writes', { timeout: 90000 }, async () => {
  const server = spawn('./node_modules/.bin/next', ['start', "-H", "127.0.0.1", '-p', '3246'], {
    env: process.env, stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(origin + '/login')).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Next production server became ready');
    const send = (path, headers, method = 'POST') => fetch(origin + path, {
      method, headers: { 'content-type': 'application/json', ...headers }, body: '{}',
    });
    // All these payloads would otherwise reach their handler and yield 400/401.
    for (const [path, method] of [['/api/auth/login', 'POST'], ['/api/auth/register', 'POST'],
      ['/api/invitations/accept', 'POST'], ['/api/companies', 'POST'],
      ['/api/team/00000000-0000-4000-8000-000000000000', 'PATCH']]) {
      for (const headers of [{ origin: 'https://attacker.invalid' }, { origin: 'null' },
        { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
        const response = await send(path, headers, method);
        assert.equal(response.status, 403, `${method} ${path}: ${JSON.stringify(headers)}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('set-cookie'), null);
      }
    }
    const revokePath = '/api/invitations/00000000-0000-4000-8000-000000000000?tenantId=00000000-0000-4000-8000-000000000001';
    for (const headers of [{}, { origin, 'sec-fetch-site': 'same-origin' }]) {
      const response = await fetch(origin + revokePath, { method: 'DELETE', headers });
      assert.equal(response.status, 401, 'bodyless invitation revoke reaches authentication');
    }
    const revoke = await fetch(origin + revokePath, { method: 'DELETE', headers: { origin: 'https://attacker.invalid' } });
    assert.equal(revoke.status, 403, 'bodyless revoke retains the origin boundary');
    assert.equal(revoke.headers.get('set-cookie'), null);
    const plain = await send('/api/auth/login', { 'content-type': 'text/plain' });
    assert.equal(plain.status, 415);
    assert.equal((await send('/api/auth/login', { origin, 'sec-fetch-site': 'same-origin' })).status, 401);
    assert.equal((await send('/api/auth/login', {})).status, 401, 'non-browser JSON clients remain compatible');
    const forgedHost = await send('/api/auth/login', { origin: 'https://attacker.invalid', 'x-forwarded-host': 'attacker.invalid' });
    assert.equal(forgedHost.status, 403);
    assert.equal((await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { origin } })).status, 200);
    const logout = await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { origin: 'https://attacker.invalid' } });
    assert.equal(logout.status, 403);
    assert.equal(logout.headers.get('set-cookie'), null);
  } finally {
    server.kill('SIGTERM');
  }
});
