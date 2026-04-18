import { NextResponse } from "next/server";
import { generateHtmlPanel, planQuery } from "@/lib/analytics";
import { connectSandbox, runPythonAnalysis } from "@/lib/e2b";
import { getSessionState, upsertSessionState } from "@/lib/server/session-store";
import type { DashboardPanel } from "@/lib/types";
import { makeId, nowIso } from "@/lib/utils";

export const runtime = "nodejs";

const fallbackAssistant =
  "The core upload-to-dashboard flow is live. Add `MISTRAL_API_KEY` to enable the full question-answering copilot against your dataset.";

export async function POST(request: Request) {
  const { sessionId, prompt } = (await request.json()) as {
    sessionId?: string;
    prompt?: string;
  };

  if (!sessionId || !prompt) {
    return NextResponse.json(
      { error: "sessionId and prompt are required." },
      { status: 400 },
    );
  }

  const session = getSessionState(sessionId);

  if (!session || !session.profile) {
    return NextResponse.json({ error: "Session is not ready yet." }, { status: 404 });
  }

  const userMessage = {
    id: makeId("msg"),
    role: "user" as const,
    content: prompt,
    createdAt: nowIso(),
  };

  const plan = await planQuery({
    profile: session.profile,
    prompt,
  });

  if (!plan) {
    const nextState = upsertSessionState({
      ...session,
      messages: [
        ...session.messages,
        userMessage,
        {
          id: makeId("msg"),
          role: "assistant",
          content: fallbackAssistant,
          createdAt: nowIso(),
        },
      ],
    });

    return NextResponse.json(nextState);
  }

  const sandbox = await connectSandbox(session.sandboxId);
  const raw = await runPythonAnalysis(sandbox, plan.analysisCode);
  const resultLine = raw
    .split("\n")
    .find((line) => line.startsWith("RESULT_JSON:"));

  if (!resultLine) {
    throw new Error("The query analysis did not produce RESULT_JSON output.");
  }

  const result = JSON.parse(resultLine.replace("RESULT_JSON:", ""));
  let panel: DashboardPanel | null = null;

  if (plan.responseType === "chart" && result.spec) {
    panel = {
      id: makeId("panel"),
      kind: "plotly",
      title: plan.title,
      description: "Generated in response to your question",
      insight: plan.insight,
      spec: result.spec,
    };
  } else if (plan.responseType === "table" && result.columns && result.rows) {
    panel = {
      id: makeId("panel"),
      kind: "table",
      title: plan.title,
      description: "Generated in response to your question",
      insight: plan.insight,
      columns: result.columns,
      rows: result.rows,
    };
  } else if (plan.responseType === "html") {
    panel = await generateHtmlPanel({
      title: plan.title,
      prompt,
      result,
    });
  }

  const nextState = upsertSessionState({
    ...session,
    panels: panel ? [panel, ...session.panels] : session.panels,
    insights: panel?.insight ? [panel.insight, ...session.insights].slice(0, 5) : session.insights,
    messages: [
      ...session.messages,
      userMessage,
      {
        id: makeId("msg"),
        role: "assistant",
        content: plan.assistantMessage,
        code: plan.analysisCode,
        panelId: panel?.id,
        createdAt: nowIso(),
      },
    ],
  });

  return NextResponse.json(nextState);
}
