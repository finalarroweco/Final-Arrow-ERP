import { NextRequest, NextResponse } from "next/server";
import { apiMutationFailure } from "./lib/request-security";

export function middleware(request: NextRequest) {
  const failure = apiMutationFailure(request);
  if (failure) return NextResponse.json({ error: failure.error }, {
    status: failure.status, headers: { "Cache-Control": "no-store" },
  });
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
