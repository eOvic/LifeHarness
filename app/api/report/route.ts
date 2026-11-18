import { weekReportFor } from "@/src/server/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const start = new URL(req.url).searchParams.get("start") ?? undefined;
  const { schedule: _s, ...report } = weekReportFor(start);
  return Response.json(report);
}
