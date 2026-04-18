import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <DashboardShell sessionId={sessionId} />;
}
