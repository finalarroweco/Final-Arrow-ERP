import { NextResponse } from 'next/server';
import { apiErrorCode } from './locale';

/** Additive error contract. Preserve status, headers and existing domain codes.
 * Success bodies and response options pass through unchanged. Legacy error text
 * remains for API compatibility, but clients must present only allowlisted codes.
 */
export function apiJson(body: unknown, init?: ResponseInit) {
  const status = init?.status ?? 200;
  if (status >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
    const value = body as Record<string, unknown>;
    const nestedCode = value.error && typeof value.error === 'object' ? (value.error as {code?: unknown}).code : undefined;
    body = { ...value, code: typeof value.code === 'string' ? value.code : typeof nestedCode === 'string' ? nestedCode : apiErrorCode(status) };
    // Never expose unexpected server/database details in a 5xx response.
    if (status >= 500) body = { code: apiErrorCode(status), error: 'Request outcome could not be verified' };
  }
  return NextResponse.json(body, init);
}
