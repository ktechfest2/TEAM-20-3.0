import type { NextRequest } from "next/server";
import { searchPollingUnits } from "@/lib/seed/registry";
import { describeRecords } from "@/lib/seed/disclaimer";

/**
 * Public, paginated by `limit` (max 50). Each unit carries its own `synthetic` flag; the top-level
 * `synthetic` is true only when every returned unit is a fictional sample unit, and `disclaimer`
 * names exactly the kinds of data in the response.
 */
export function GET(request: NextRequest) {
  const search = (request.nextUrl.searchParams.get("search") ?? "").slice(0, 100);
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20;
  const data = searchPollingUnits(search, limit);
  return Response.json({ data, ...describeRecords(data) });
}
