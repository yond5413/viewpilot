import type {
  QueryTrace,
  QueryTraceEvent,
  QueryTraceSummary,
  StageError,
} from "@/lib/types";
import { makeId, nowIso } from "@/lib/utils";

type TraceMap = Map<string, QueryTrace>;
type SessionTraceMap = Map<string, string[]>;

declare global {
  var __viewpilotQueryTraces__: TraceMap | undefined;
  var __viewpilotQueryTraceSessions__: SessionTraceMap | undefined;
}

const traces = globalThis.__viewpilotQueryTraces__ ?? new Map<string, QueryTrace>();
const sessionTraceIds =
  globalThis.__viewpilotQueryTraceSessions__ ?? new Map<string, string[]>();

if (!globalThis.__viewpilotQueryTraces__) {
  globalThis.__viewpilotQueryTraces__ = traces;
}

if (!globalThis.__viewpilotQueryTraceSessions__) {
  globalThis.__viewpilotQueryTraceSessions__ = sessionTraceIds;
}

const MAX_TRACES_PER_SESSION = 10;

export const createQueryTrace = (sessionId: string, prompt: string): QueryTrace => {
  const trace: QueryTrace = {
    traceId: makeId("trace"),
    sessionId,
    prompt,
    createdAt: nowIso(),
    events: [],
    finalStatus: "success",
  };

  traces.set(trace.traceId, trace);
  const nextIds = [trace.traceId, ...(sessionTraceIds.get(sessionId) ?? [])].slice(
    0,
    MAX_TRACES_PER_SESSION,
  );
  sessionTraceIds.set(sessionId, nextIds);

  for (const staleId of traces.keys()) {
    if (!Array.from(sessionTraceIds.values()).some((ids) => ids.includes(staleId))) {
      traces.delete(staleId);
    }
  }

  return trace;
};

export const appendQueryTraceEvent = (
  traceId: string,
  event: QueryTraceEvent,
) => {
  const trace = traces.get(traceId);
  if (!trace) {
    return undefined;
  }

  trace.events.push(event);
  return trace;
};

export const finalizeQueryTrace = (args: {
  traceId: string;
  finalStatus: QueryTrace["finalStatus"];
  failedStage?: QueryTrace["failedStage"];
}) => {
  const trace = traces.get(args.traceId);
  if (!trace) {
    return undefined;
  }

  trace.finalStatus = args.finalStatus;
  trace.failedStage = args.failedStage;
  return trace;
};

export const summarizeQueryTrace = (
  traceId: string,
  error?: StageError,
): QueryTraceSummary | undefined => {
  const trace = traces.get(traceId);
  if (!trace) {
    return undefined;
  }

  return {
    traceId: trace.traceId,
    createdAt: trace.createdAt,
    finalStatus: trace.finalStatus,
    failedStage: trace.failedStage,
    errorCode: error?.code,
    errorMessage: error?.message,
    stageCount: trace.events.length,
  };
};

export const getQueryTrace = (traceId: string) => traces.get(traceId);
