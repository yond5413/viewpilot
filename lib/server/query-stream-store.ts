import type { AnalysisStreamEvent } from "@/lib/types";
import { makeId, nowIso } from "@/lib/utils";

type StreamState = {
  traceId?: string;
  active: boolean;
  events: AnalysisStreamEvent[];
};

type StreamMap = Map<string, StreamState>;

declare global {
  var __viewpilotQueryStreams__: StreamMap | undefined;
}

const streams = globalThis.__viewpilotQueryStreams__ ?? new Map<string, StreamState>();

if (!globalThis.__viewpilotQueryStreams__) {
  globalThis.__viewpilotQueryStreams__ = streams;
}

const MAX_EVENTS = 80;

export const startQueryStream = (sessionId: string, traceId?: string) => {
  const existing = streams.get(sessionId);
  const state: StreamState = {
    traceId,
    active: true,
    events: existing?.active && existing.traceId === traceId ? existing.events : [],
  };
  streams.set(sessionId, state);
  return state;
};

export const appendQueryStreamEvent = (
  sessionId: string,
  event: Omit<AnalysisStreamEvent, "id" | "sessionId" | "ts">,
) => {
  const state = streams.get(sessionId) ?? startQueryStream(sessionId, event.traceId);
  const nextEvent: AnalysisStreamEvent = {
    id: makeId("stream"),
    sessionId,
    ts: nowIso(),
    ...event,
  };

  state.events = [...state.events, nextEvent].slice(-MAX_EVENTS);
  if (event.traceId) {
    state.traceId = event.traceId;
  }
  streams.set(sessionId, state);
  return nextEvent;
};

export const completeQueryStream = (sessionId: string, traceId?: string) => {
  const state = streams.get(sessionId) ?? startQueryStream(sessionId, traceId);
  state.active = false;
  if (traceId) {
    state.traceId = traceId;
  }
  streams.set(sessionId, state);
  return state;
};

export const getQueryStream = (sessionId: string) => streams.get(sessionId);
