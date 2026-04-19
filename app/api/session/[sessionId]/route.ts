import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/server/session-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const session = await getSessionState(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Unknown session." }, { status: 404 });
  }

  return NextResponse.json(session);
}
