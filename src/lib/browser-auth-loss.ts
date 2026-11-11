/** Recognize observed authentication loss, not ordinary business conflicts or network failures. */
export function browserAuthLost(response: Pick<Response, "status" | "redirected" | "url">, data?: unknown) {
  if (response.status === 401 || response.status === 403) return true;
  if (response.redirected) {
    try { if (new URL(response.url).pathname === "/login") return true; } catch { /* Not a verified login redirect. */ }
  }
  return response.status === 409 && typeof data === "object" && data !== null && "code" in data && data.code === "ACTOR_MISMATCH";
}
