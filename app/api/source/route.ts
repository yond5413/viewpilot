import { NextResponse } from "next/server";
import { initializeAnalysisState } from "@/lib/agent-workflow";
import {
  buildInitialDashboard,
  generateSuggestedPrompts,
  parseExplorePayload,
} from "@/lib/analytics";
import {
  connectSandbox,
  runExploreScript,
  runLoadSourceScript,
  writeSessionAnalysisStateToSandbox,
  writeSourceConfigToSandbox,
} from "@/lib/e2b";
import { getSessionState, upsertSessionState } from "@/lib/server/session-store";
import { makeId, nowIso } from "@/lib/utils";

export const runtime = "nodejs";

type SourceRequest = {
  sessionId?: string;
  source?: {
    kind?: string;
    label?: string;
    request?: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    };
    response?: {
      recordsPath?: string;
    };
  };
};

const parseSourceSummary = (raw: string) => {
  const summaryLine = raw
    .split("\n")
    .find((line) => line.startsWith("SOURCE_JSON:"));

  if (!summaryLine) {
    throw new Error("Source loader did not return SOURCE_JSON payload.");
  }

  return JSON.parse(summaryLine.replace("SOURCE_JSON:", "")) as {
    label: string;
    rows: number;
  };
};

export async function POST(request: Request) {
  const { sessionId, source } = (await request.json()) as SourceRequest;

  if (
    !sessionId ||
    !source ||
    source.kind !== "api" ||
    !source.request?.url
  ) {
    return NextResponse.json(
      { error: "sessionId and a valid API source are required." },
      { status: 400 },
    );
  }

  const session = getSessionState(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Unknown session." }, { status: 404 });
  }

  const sandbox = await connectSandbox(session.sandboxId);

  await writeSourceConfigToSandbox(sandbox, source);

  const sourceLoadRaw = await runLoadSourceScript(sandbox);
  const sourceSummary = parseSourceSummary(sourceLoadRaw);
  const rawExplore = await runExploreScript(sandbox);
  const initial = buildInitialDashboard(parseExplorePayload(rawExplore));
  const analysisState = initializeAnalysisState({
    profile: initial.profile,
    kpis: initial.kpis,
    panels: initial.panels,
    insights: initial.insights,
  });
  const suggestedPrompts = await generateSuggestedPrompts({
    profile: initial.profile,
    insights: initial.insights,
  });

  await writeSessionAnalysisStateToSandbox(sandbox, analysisState);

  const nextState = upsertSessionState({
    ...session,
    status: "dashboard_ready",
    filename: sourceSummary.label,
    profile: initial.profile,
    kpis: analysisState.validatedMetrics,
    panels: analysisState.validatedPanels,
    insights: initial.insights,
    suggestedPrompts,
    analysisState,
    messages: [
      ...session.messages,
      {
        id: makeId("msg"),
        role: "system",
        content: `Loaded ${sourceSummary.label} inside the sandbox and generated an initial dashboard from ${sourceSummary.rows.toLocaleString()} rows.`,
        createdAt: nowIso(),
      },
    ],
    exportReady: false,
  });

  return NextResponse.json(nextState);
}
