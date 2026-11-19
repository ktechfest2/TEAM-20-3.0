import type { NextRequest } from "next/server";
import { SYNTHETIC_DISCLAIMER, searchPollingUnits } from "@/lib/seed/registry";

/** Public, paginated by `limit` (max 50). Synthetic demo registry only in this build. */
export function GET(request: NextRequest) {
  const search = (request.nextUrl.searchParams.get("search") ?? "").slice(0, 100);
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20;
  const data = searchPollingUnits(search, limit);
  return Response.json({ data, synthetic: true, disclaimer: SYNTHETIC_DISCLAIMER });
}
