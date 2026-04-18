import type { DashboardState, SessionAnalysisState } from "@/lib/types";
import { nowIso } from "@/lib/utils";

type SessionMap = Map<string, DashboardState>;

declare global {
  var __viewpilotSessions__: SessionMap | undefined;
}

const sessions = globalThis.__viewpilotSessions__ ?? new Map<string, DashboardState>();

if (!globalThis.__viewpilotSessions__) {
  globalThis.__viewpilotSessions__ = sessions;
}

export const createEmptyAnalysisState = (): SessionAnalysisState => ({
  validatedMetrics: [],
  validatedPanels: [],
  cachedResults: {},
  taskHistory: [],
  failedPatterns: [],
  artifacts: [],
  currentDashboardVersion: 0,
  observability: {
    requestCount: 0,
    cacheHitCount: 0,
    executionCount: 0,
    executionFailureCount: 0,
    validationRejectCount: 0,
    criticRejectCount: 0,
    fallbackCount: 0,
    panelReplacementCount: 0,
    totalRuntimeMs: 0,
  },
});

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
  suggestedPrompts: [],
  messages: [
    {
      id: `msg-${sessionId}`,
      role: "assistant",
      content:
        "Upload a CSV or launch a demo source and I’ll turn it into a live analytics workspace inside an E2B sandbox.",
      createdAt: nowIso(),
    },
  ],
  analysisState: createEmptyAnalysisState(),
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
