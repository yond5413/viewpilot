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
  uploadCsvToSandbox,
  writeSessionAnalysisStateToSandbox,
} from "@/lib/e2b";
import { getSessionState, upsertSessionState } from "@/lib/server/session-store";
import { makeId, nowIso } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const sessionId = String(formData.get("sessionId") || "");
  const file = formData.get("file");

  if (!sessionId || !(file instanceof File)) {
    return NextResponse.json(
      { error: "sessionId and file are required." },
      { status: 400 },
    );
  }

  const session = await getSessionState(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Unknown session." }, { status: 404 });
  }

  const sandbox = await connectSandbox(session.sandboxId);
  const bytes = Buffer.from(await file.arrayBuffer());

  await uploadCsvToSandbox(sandbox, file.name, bytes);
  const rawExplore = await runExploreScript(sandbox);
  const initial = buildInitialDashboard(parseExplorePayload(rawExplore));
  const analysisState = initializeAnalysisState({
    profile: initial.profile,
    analysisMemory: initial.analysisMemory,
    kpis: initial.kpis,
    panels: initial.panels,
    insights: initial.insights,
  });
  const suggestedPrompts = await generateSuggestedPrompts({
    profile: initial.profile,
    analysisMemory: initial.analysisMemory,
    existingPanels: initial.panels,
    insights: initial.insights,
  });

  await writeSessionAnalysisStateToSandbox(sandbox, analysisState);

  const nextState = await upsertSessionState({
    ...session,
    status: "dashboard_ready",
    filename: file.name,
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
        content: `Uploaded ${file.name} and generated an initial dashboard.`,
        createdAt: nowIso(),
      },
    ],
    exportReady: false,
  });

  return NextResponse.json(nextState);
}
