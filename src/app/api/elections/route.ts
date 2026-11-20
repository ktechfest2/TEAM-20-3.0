import { ELECTIONS } from "@/lib/seed/registry";
import { describeRecords } from "@/lib/seed/disclaimer";

/** Public. Each election carries its own `synthetic` flag; top-level fields describe the set. */
export function GET() {
  return Response.json({ data: ELECTIONS, ...describeRecords(ELECTIONS) });
}
