import { ELECTIONS, SYNTHETIC_DISCLAIMER } from "@/lib/seed/registry";

/** Public. Synthetic demo registry only in this build. */
export function GET() {
  return Response.json({ data: ELECTIONS, synthetic: true, disclaimer: SYNTHETIC_DISCLAIMER });
}
