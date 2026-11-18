"use client";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { refreshSidebar } from "@/components/Shell";
import { IconButton, Label } from "@/components/ui";
import { getJson } from "@/lib/api";
import type { ChatSummary } from "@/src/server/store";

const KIND: Record<string, string> = { onboarding: "Interview + plan", review: "Weekly review", replan: "Re-plan" };

export default function Sessions() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const load = () => getJson<ChatSummary[]>("/api/chats").then(setChats).catch(() => setChats([]));
  useEffect(() => {
    load();
  }, []);
  const del = async (id: string) => {
    if (!confirm("Delete this session transcript? Your life map and plans are kept.")) return;
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    load();
    refreshSidebar();
  };
  return (
    <>
      <PageHeader title="Sessions" meta="every conversation with your coach" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="mx-auto max-w-[760px] px-6 pb-12 pt-6">
          {chats?.map((c) => (
            <li key={c.id} className="group flex items-center gap-4 border-b border-line-soft py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/session/${c.id}`} className="text-[16px] text-ink hover:text-accent">
                  {c.title}
                </Link>
                <div className="lh-mono mt-0.5 text-[11px] uppercase tracking-[0.06em] text-muted">
                  {KIND[c.kind] ?? c.kind} · {c.questions} questions · {new Date(c.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
              <IconButton onClick={() => del(c.id)} title="Delete transcript" className="opacity-0 group-hover:opacity-100">
                <Trash2 />
              </IconButton>
            </li>
          ))}
          {chats && !chats.length && (
            <li className="py-10 text-center">
              <Label>No sessions yet</Label>
            </li>
          )}
        </ul>
      </div>
    </>
  );
}
