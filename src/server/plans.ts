// Adopting a proposed plan: a new immutable version that applies from today on.
import { mergeProfile, snapshotOf } from "../core/profile";
import type { Plan } from "../core/types";
import { getChat, getPlans, getProfile, saveChat, savePlans, saveProfile } from "./store";
import { TurnError } from "./agent";

export function adoptProposal(chatId: string): Plan {
  const rec = getChat(chatId);
  if (!rec) throw new TurnError("Session not found", 404);
  const prop = rec.proposal;
  if (!prop) throw new TurnError("No plan has been proposed in this session", 409);
  if (prop.adoptedVersion) throw new TurnError(`Already adopted as v${prop.adoptedVersion}`, 409);
  const profile = getProfile();
  // The goal tree becomes part of the life map (upsert by id).
  const merged = mergeProfile(profile, { goals: prop.goals }).profile;
  saveProfile(merged);
  const plans = getPlans();
  const version = (plans[plans.length - 1]?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const plan: Plan = {
    version,
    createdAt: prop.proposedAt,
    adoptedAt: now,
    approach: prop.approach,
    goals: prop.goals,
    blocks: prop.blocks,
    snapshot: snapshotOf(merged),
    chatId,
  };
  savePlans([...plans, plan]);
  rec.proposal = { ...prop, adoptedVersion: version };
  saveChat(rec);
  return plan;
}
