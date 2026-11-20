// Google Calendar: status; connect (returns Google's sign-in page), cancel, sync now, disconnect.
// The client secret and tokens never come back to the page (src/server/google-calendar.ts).
import { cancelConnect, disconnect, GoogleError, googleStatus, startConnect, syncNow } from "@/src/server/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(googleStatus());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; clientId?: unknown; clientSecret?: unknown };
  try {
    switch (b.action) {
      case "connect": {
        const id = typeof b.clientId === "string" ? b.clientId : undefined;
        const secret = typeof b.clientSecret === "string" ? b.clientSecret : undefined;
        const { authUrl } = await startConnect(id, secret); // none given: the saved client
        return Response.json({ ...googleStatus(), authUrl });
      }
      case "cancel":
        cancelConnect();
        return Response.json(googleStatus());
      case "sync":
        return Response.json(await syncNow());
      case "disconnect":
        await disconnect();
        return Response.json(googleStatus());
      default:
        return Response.json({ error: "action must be connect | cancel | sync | disconnect" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof GoogleError ? 400 : 500 });
  }
}
