import { NextResponse } from "next/server";
import { createSandbox } from "@/lib/e2b";
import { createSessionState, upsertSessionState } from "@/lib/server/session-store";

export const runtime = "nodejs";

export async function POST() {
  const sandbox = await createSandbox();
  const sessionState = createSessionState(sandbox.sandboxId, sandbox.sandboxId);
  await upsertSessionState(sessionState);

  return NextResponse.json({
    sessionId: sessionState.sessionId,
    sandboxId: sessionState.sandboxId,
  });
}
