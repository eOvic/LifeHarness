// Manual edits to the life map (settings page). The interviewer uses the same merge.
import { coverage, mergeProfile, type ProfilePatch } from "@/src/core/profile";
import { execUpdateProfile } from "@/src/server/tools";
import { getProfile } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const profile = getProfile();
  return Response.json({ profile, coverage: coverage(profile) });
}

export async function POST(req: Request) {
  const patch = (await req.json().catch(() => null)) as ProfilePatch | null;
  if (!patch || typeof patch !== "object") return Response.json({ error: "Bad patch" }, { status: 400 });
  mergeProfile(getProfile(), patch); // throws on malformed input before anything is saved
  const out = await execUpdateProfile(patch);
  const profile = getProfile();
  return Response.json({ profile, coverage: coverage(profile), message: out.text.split("\n")[0] });
}
