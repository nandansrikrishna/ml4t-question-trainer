import { AUTH_RETURN_COOKIE, authReturnPath } from "../../../lib/auth-return";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext =
    url.searchParams.get("next") ??
    request.cookies.get(AUTH_RETURN_COOKIE)?.value;
  let decodedNext = requestedNext;
  try {
    decodedNext = requestedNext ? decodeURIComponent(requestedNext) : undefined;
  } catch {
    decodedNext = undefined;
  }
  const next = authReturnPath(decodedNext);
  const redirect = (target: URL) => {
    const response = NextResponse.redirect(target);
    response.cookies.delete(AUTH_RETURN_COOKIE);
    return response;
  };

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirect(new URL(next, url.origin));
  }

  const errorUrl = new URL(next, url.origin);
  errorUrl.searchParams.set("authError", "callback");
  return redirect(errorUrl);
}
