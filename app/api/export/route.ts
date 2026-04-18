import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "PDF export is scaffolded next but not enabled in this build yet. The analytics workspace itself is ready for dataset testing.",
    },
    { status: 501 },
  );
}
