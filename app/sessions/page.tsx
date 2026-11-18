"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJson } from "@/lib/api";

type Chat = { id: string; kind: string; title: string; phase: string; createdAt: string; updatedAt: string };
const KIND: Record<string, string> = { onboarding: "Interview + plan", review: "Weekly review", replan: "Re-plan" };

export default function Sessions() {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const load = () => getJson<Chat[]>("/api/chats").then(setChats).catch(() => setChats([]));
  useEffect(() => {
    load();
  }, []);
  const del = async (id: string) => {
    if (!confirm("Delete this session transcript? Your life map and plans are kept.")) return;
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    load();
  };
  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
      <p className="text-sm text-muted">Every conversation with the coach. Transcripts are stored locally.</p>
      <ul className="mt-5 space-y-2">
        {chats?.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/session/${c.id}`} className="font-medium hover:text-accent">
                {c.title}
              </Link>
              <div className="text-xs text-muted">
                {KIND[c.kind] ?? c.kind} · phase {c.phase} · {new Date(c.updatedAt).toLocaleString()}
              </div>
            </div>
            <button type="button" onClick={() => del(c.id)} className="text-xs text-muted hover:text-red-600">
              Delete
            </button>
          </li>
        ))}
        {chats && !chats.length && <li className="text-sm text-muted">No sessions yet.</li>}
      </ul>
    </div>
  );
}
