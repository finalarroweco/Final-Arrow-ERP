/** Browser CSRF boundary for cookie-authenticated JSON API mutations.
 * Host is the incoming HTTP authority (Next may use an internal hostname in url).
 * Never trust client-supplied forwarded-host headers or suffix matches.
 */
export function apiMutationFailure(request: Pick<Request, "method" | "url" | "headers">):
  { status: number; error: string } | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;
  const forbidden = { status: 403, error: "Cross-origin requests are not allowed" };
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return forbidden;

  const target = new URL(request.url);
  const host = request.headers.get("host") ?? target.host;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      const source = new URL(origin);
      // An Origin is an origin, not an arbitrary URL, list, or opaque origin.
      if (source.origin !== origin || source.host !== host || source.protocol !== target.protocol)
        return forbidden;
    } catch {
      return forbidden;
    }
  } else if (site === "same-site") {
    // A sibling subdomain must not gain write access when Origin is absent.
    return forbidden;
  }

  // Existing mutations accept JSON, except bodyless logout and invitation revoke.
  // Requiring this non-safelisted media type also protects older browsers that
  // omit Origin/Fetch Metadata. Non-browser API clients need no Origin header.
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const bodylessEndpoint =
    (request.method.toUpperCase() === "POST" && target.pathname === "/api/auth/logout") ||
    (request.method.toUpperCase() === "DELETE" &&
      /^\/api\/invitations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.pathname));
  if (contentType !== "application/json" && !(bodylessEndpoint && !contentType)) {
    return { status: 415, error: "Content-Type must be application/json" };
  }
  return null;
}
