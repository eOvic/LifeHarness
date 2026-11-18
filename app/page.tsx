import { redirect } from "next/navigation";
import { currentPlan } from "@/src/server/store";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect(currentPlan() ? "/today" : "/start");
}
