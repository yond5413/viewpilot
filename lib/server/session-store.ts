import type { DashboardState, SessionAnalysisState } from "@/lib/types";
import { getRedisClient } from "@/lib/server/redis";
import { nowIso } from "@/lib/utils";

const SESSION_TTL_SECONDS = 60 * 60 * 24;

const sessionKey = (sessionId: string) => `session:${sessionId}`;

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

export const getSessionState = async (sessionId: string) => {
  const redis = await getRedisClient();
  const raw = await redis.get(sessionKey(sessionId));

  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as DashboardState;
  } catch {
    return undefined;
  }
};

export const upsertSessionState = async (state: DashboardState) => {
  const redis = await getRedisClient();
  state.lastUpdatedAt = nowIso();
  await redis.set(sessionKey(state.sessionId), JSON.stringify(state), {
    EX: SESSION_TTL_SECONDS,
  });
  return state;
};

export const updateSessionState = async (
  sessionId: string,
  updater: (current: DashboardState) => DashboardState,
) => {
  const current = await getSessionState(sessionId);
  if (!current) {
    return undefined;
  }

  const next = updater(current);
  return upsertSessionState(next);
};
