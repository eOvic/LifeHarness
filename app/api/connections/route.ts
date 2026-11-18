// Which AI providers can be connected, and which are (never the secrets themselves).
import { listProviders } from "@/src/server/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ providers: await listProviders() });
  } catch (e) {
    return Response.json({ providers: [], error: (e as Error).message }, { status: 500 });
  }
}
