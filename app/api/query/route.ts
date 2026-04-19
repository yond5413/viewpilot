import { NextResponse } from "next/server";
import {
  formatQueryStageLabel,
  runInvestorWorkflow,
  WorkflowStageError,
} from "@/lib/agent-workflow";
import { summarizeQueryTrace } from "@/lib/query-trace-store";
import { getSessionState, upsertSessionState } from "@/lib/server/session-store";
import type { DashboardState } from "@/lib/types";
import { makeId, nowIso } from "@/lib/utils";

export const runtime = "nodejs";

const fallbackAssistant =
  "The core upload-to-dashboard flow is live. Add `MISTRAL_API_KEY` to enable the full question-answering copilot against your dataset.";

const resolveClarificationPrompt = (session: DashboardState, prompt: string) => {
  const pending = session.analysisState.pendingClarification;
  if (!pending) {
    return { prompt, pending: undefined as undefined | typeof pending, keepWaiting: false };
  }

  const normalized = prompt.trim().toUpperCase();
  const matchedOption = pending.options.find((option) => option.id.toUpperCase() === normalized);

  if (matchedOption?.id === "D") {
    return { prompt, pending, keepWaiting: true };
  }

  if (matchedOption?.resolvedPrompt) {
    return { prompt: matchedOption.resolvedPrompt, pending, keepWaiting: false };
  }

  return {
    prompt: `${pending.originalPrompt}\nClarification from user: ${prompt.trim()}`,
    pending,
    keepWaiting: false,
  };
};

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

  const session = await getSessionState(sessionId);
  if (!session || !session.profile) {
    return NextResponse.json({ error: "Session is not ready yet." }, { status: 404 });
  }

  const userMessage = {
    id: makeId("msg"),
    role: "user" as const,
    content: prompt,
    createdAt: nowIso(),
  };

  const clarification = resolveClarificationPrompt(session, prompt);

  if (clarification.keepWaiting && clarification.pending) {
    const nextState = await upsertSessionState({
      ...session,
      messages: [
        ...session.messages,
        userMessage,
        {
          id: makeId("msg"),
          role: "assistant",
          content:
            "Tell me the exact change you want and I’ll use that to continue. For example: replace the current pie chart with a ranked bar chart using outlay amount.",
          createdAt: nowIso(),
        },
      ],
    });

    return NextResponse.json(nextState);
  }

  try {
    const workingSession = {
      ...session,
      analysisState: {
        ...session.analysisState,
        pendingClarification: undefined,
      },
      messages: [...session.messages, userMessage],
    };

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Query timed out. The sandbox may be under load — try again.")), 55_000),
    );
    const nextState = await Promise.race([
      runInvestorWorkflow({
        session: workingSession,
        prompt: clarification.prompt,
      }),
      timeoutPromise,
    ]);

    return NextResponse.json(await upsertSessionState(nextState));
  } catch (error) {
    const traceSummary =
      error instanceof WorkflowStageError
        ? summarizeQueryTrace(error.traceId, {
            code: error.code,
            message: error.message,
          })
        : undefined;

    const nextState = await upsertSessionState({
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
