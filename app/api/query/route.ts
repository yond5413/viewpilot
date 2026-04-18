import { NextResponse } from "next/server";
import {
  formatQueryStageLabel,
  runInvestorWorkflow,
  WorkflowStageError,
} from "@/lib/agent-workflow";
import { summarizeQueryTrace } from "@/lib/query-trace-store";
import { getSessionState, upsertSessionState } from "@/lib/server/session-store";
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

  try {
    const workingSession = {
      ...session,
      messages: [...session.messages, userMessage],
    };

    const nextState = await runInvestorWorkflow({
      session: workingSession,
      prompt,
    });

    return NextResponse.json(upsertSessionState(nextState));
  } catch (error) {
    const traceSummary =
      error instanceof WorkflowStageError
        ? summarizeQueryTrace(error.traceId, {
            code: error.code,
            message: error.message,
          })
        : undefined;

    const nextState = upsertSessionState({
      ...session,
      analysisState: {
        ...session.analysisState,
        lastQueryTraceSummary: traceSummary,
      },
      messages: [
        ...session.messages,
        userMessage,
        {
          id: makeId("msg"),
          role: "assistant",
          content:
            error instanceof WorkflowStageError
              ? `I couldn’t complete that analysis. It failed during ${formatQueryStageLabel(error.stage)}. Trace ${error.traceId}.`
              : error instanceof Error
                ? `I couldn’t complete that analysis yet. ${error.message}`
              : fallbackAssistant,
          createdAt: nowIso(),
        },
      ],
    });

    return NextResponse.json(nextState);
  }
}
