import type { DashboardState } from "@/lib/types";

export async function fetchDashboardState(sessionId: string) {
  const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to fetch session state.");
  }

  return (await response.json()) as DashboardState;
}
