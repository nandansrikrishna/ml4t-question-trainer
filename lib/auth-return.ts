export const AUTH_RETURN_COOKIE = "ml4t-auth-return";
const RETURN_PATHS = new Set([
  "/",
  "/practice-exam",
  "/progress",
  "/review",
  "/learning-guide",
]);
export function authReturnPath(value: string | null | undefined) {
  return value && RETURN_PATHS.has(value) ? value : "/";
}
export function rememberAuthReturn(value: string) {
  // Keep Supabase's existing exact callback allowlist. The same-origin cookie
  // carries the destination through OAuth and magic-link navigation/new tabs.
  document.cookie = `${AUTH_RETURN_COOKIE}=${encodeURIComponent(authReturnPath(value))}; Path=/; Max-Age=3600; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
