/**
 * Client IP for rate limiting (server-only). Order:
 *  1. x-vercel-forwarded-for (set by Vercel's edge; first entry)
 *  2. x-real-ip
 *  3. x-forwarded-for, RIGHTMOST entry: the hop added by our nearest proxy. The leftmost entry
 *     is whatever the client sent and is trivially spoofable.
 * Limits keyed on this are abuse friction, not identity. Behind several proxies the rightmost
 * entry may be a proxy address, which makes limits stricter (shared bucket), never looser.
 */
export function clientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel?.trim()) return vercel.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff?.trim()) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts.at(-1)!;
  }
  return "unknown";
}
