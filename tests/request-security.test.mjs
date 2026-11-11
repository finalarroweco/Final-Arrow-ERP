import assert from 'node:assert/strict';
import test from 'node:test';
import { apiMutationFailure } from '../src/lib/request-security.ts';

const origin = 'https://erp.example.com';
function check({ method = 'POST', path = '/api/companies', url = origin + path, headers = {} } = {}) {
  return apiMutationFailure({ method, url, headers: new Headers({ 'content-type': 'application/json', ...headers }) });
}

test('allows same-origin JSON and non-browser API clients', () => {
  assert.equal(check(), null);
  assert.equal(check({ headers: { origin, 'sec-fetch-site': 'same-origin' } }), null);
  assert.equal(check({ headers: { origin, 'content-type': 'application/json; charset=utf-8' } }), null);
  assert.equal(check({ headers: { origin, 'content-type': 'Application/JSON' } }), null);
});

test('rejects cross-origin, sibling origins, opaque and malformed origins', () => {
  for (const source of ['https://attacker.invalid', 'https://sibling.example.com', 'http://erp.example.com',
    'https://erp.example.com:444', 'https://erp.example.com.attacker.invalid', 'null', '', origin + '/path',
    origin + '/', origin + ' https://attacker.invalid', 'https://user@erp.example.com']) {
    assert.equal(check({ headers: { origin: source } })?.status, 403, source);
  }
});

test('fetch metadata rejects cross-site and originless sibling requests', () => {
  assert.equal(check({ headers: { 'sec-fetch-site': 'cross-site' } })?.status, 403);
  assert.equal(check({ headers: { origin, 'sec-fetch-site': 'cross-site' } })?.status, 403);
  assert.equal(check({ headers: { 'sec-fetch-site': 'same-site' } })?.status, 403);
  assert.equal(check({ headers: { 'sec-fetch-site': 'none' } }), null);
});

test('validates HTTP authority, not a forwarded host supplied by a client', () => {
  assert.equal(check({ url: 'https://internal:3000/api/companies', headers: { origin, host: 'erp.example.com' } }), null);
  assert.equal(check({ headers: { origin: 'https://attacker.invalid', 'x-forwarded-host': 'attacker.invalid' } })?.status, 403);
});

test('all mutation methods require JSON and reject HTML form media types', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    for (const contentType of ['', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      assert.equal(check({ method, headers: { 'content-type': contentType } })?.status, 415);
    }
  }
});

test('bodyless logout is supported but still checks origin', () => {
  const request = { method: 'POST', url: origin + '/api/auth/logout', headers: new Headers() };
  assert.equal(apiMutationFailure(request), null);
  request.headers.set('origin', 'https://attacker.invalid');
  assert.equal(apiMutationFailure(request)?.status, 403);
});

test('read and preflight requests are not mutations', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.equal(check({ method, headers: { origin: 'null', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' } }), null);
  }
});


test('bodyless invitation revoke is supported without broadening other mutations', () => {
  const path = '/api/invitations/00000000-0000-4000-8000-000000000000';
  const request = { method: 'DELETE', url: origin + path + '?tenantId=00000000-0000-4000-8000-000000000001', headers: new Headers() };
  assert.equal(apiMutationFailure(request), null);
  request.headers.set('origin', origin);
  assert.equal(apiMutationFailure(request), null);
  request.headers.set('origin', 'https://attacker.invalid');
  assert.equal(apiMutationFailure(request)?.status, 403);
  request.headers.delete('origin');
  request.headers.set('sec-fetch-site', 'cross-site');
  assert.equal(apiMutationFailure(request)?.status, 403);
  for (const [method, endpoint] of [['POST', path], ['DELETE', '/api/invitations/accept'],
    ['DELETE', path + '/extra'], ['DELETE', '/api/companies/00000000-0000-4000-8000-000000000000']]) {
    assert.equal(apiMutationFailure({ method, url: origin + endpoint, headers: new Headers() })?.status, 415);
  }
  assert.equal(apiMutationFailure({ method: 'DELETE', url: origin + path,
    headers: new Headers({ 'content-type': 'text/plain' }) })?.status, 415);
});
