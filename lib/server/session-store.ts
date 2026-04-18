import type { DashboardState } from "@/lib/types";
import { nowIso } from "@/lib/utils";

type SessionMap = Map<string, DashboardState>;

declare global {
  var __viewpilotSessions__: SessionMap | undefined;
}

const sessions = globalThis.__viewpilotSessions__ ?? new Map<string, DashboardState>();

if (!globalThis.__viewpilotSessions__) {
  globalThis.__viewpilotSessions__ = sessions;
}

export const createSessionState = (
  sessionId: string,
  sandboxId: string,
): DashboardState => ({
  sessionId,
  sandboxId,
  status: "ready_for_upload",
  kpis: [],
  panels: [],
  insights: [],
  messages: [
    {
      id: `msg-${sessionId}`,
      role: "assistant",
      content:
        "Upload a CSV and I’ll turn it into a live analytics workspace inside an E2B sandbox.",
      createdAt: nowIso(),
    },
  ],
  exportReady: false,
  lastUpdatedAt: nowIso(),
});

export const getSessionState = (sessionId: string) => sessions.get(sessionId);

export const upsertSessionState = (state: DashboardState) => {
  state.lastUpdatedAt = nowIso();
  sessions.set(state.sessionId, state);
  return state;
};

export const updateSessionState = (
  sessionId: string,
  updater: (current: DashboardState) => DashboardState,
) => {
  const current = sessions.get(sessionId);
  if (!current) {
    return undefined;
  }

  const next = updater(current);
  next.lastUpdatedAt = nowIso();
  sessions.set(sessionId, next);
  return next;
};
