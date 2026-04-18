"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronRight,
  CircleDot,
  Download,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  PanelLeft,
  SendHorizonal,
  Sparkles,
} from "lucide-react";
import type { DashboardPanel, DashboardState } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "./cn";
import { fetchDashboardState } from "./dashboard-data";

type PlotProps = {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  useResizeHandler?: boolean;
  style?: CSSProperties;
};

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
}) as ComponentType<PlotProps>;

type DashboardShellProps = {
  sessionId: string;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
};

type SpeechRecognitionResultLike = {
  transcript?: string;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
};

type SpeechRecognitionWithWebkit = typeof window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

export function DashboardShell({ sessionId }: DashboardShellProps) {
  const [snapshot, setSnapshot] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  useEffect(() => {
    let active = true;

    const syncState = () => {
      fetchDashboardState(sessionId)
        .then((nextState) => {
          if (!active) return;
          setError(null);
          setSnapshot(nextState);
          setLoading(false);
        })
        .catch((loadError) => {
          if (!active) return;
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load the dashboard state.",
          );
          setLoading(false);
        });
    };

    syncState();
    const intervalId = window.setInterval(() => {
      syncState();
    }, 20000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [sessionId]);

  const visibleStatus = useMemo(() => {
    if (loading) return "Preparing dashboard workspace...";
    return snapshot?.status || "Ready";
  }, [loading, snapshot?.status]);

  const submitQuery = async () => {
    if (!query.trim() || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          prompt: query.trim(),
        }),
      });

      const payload = (await response.json()) as DashboardState | { error?: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "The query request failed.",
        );
      }

      setSnapshot(payload as DashboardState);
      setQuery("");
    } catch (queryError) {
      setError(
        queryError instanceof Error
          ? queryError.message
          : "Unable to run the copilot query.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const startVoiceCapture = () => {
    const speechWindow = window as SpeechRecognitionWithWebkit;
    const recognitionCtor =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (!recognitionCtor) {
      setError("Voice input is not supported in this browser.");
      return;
    }

    const recognition = new recognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => setVoiceActive(true);
    recognition.onend = () => setVoiceActive(false);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("");
      setQuery(transcript);
    };

    recognition.start();
  };

  const handleExport = async () => {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error || "PDF export is not enabled yet.");
    }
  };

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 space-y-6">
          <header className="shell-card panel-enter rounded-[28px] px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                  <Badge variant="outline" className="inline-flex items-center gap-2 rounded-full px-3 py-1 normal-case tracking-normal">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                    Session {sessionId}
                  </Badge>
                  <Badge variant="secondary" className="inline-flex items-center gap-1 rounded-full px-3 py-1 normal-case tracking-normal text-[var(--accent)]">
                    <CircleDot className="h-3 w-3" />
                    {snapshot?.filename ?? "Awaiting upload"}
                  </Badge>
                </div>
                <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
                  {snapshot?.profile?.filename ?? "Analytics workspace"}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)] sm:text-base">
                  {snapshot?.profile
                    ? `${snapshot.profile.rows.toLocaleString()} rows, ${snapshot.profile.columns} columns, and ${snapshot.profile.numericColumns.length} numeric fields profiled inside E2B.`
                    : "Loading the dashboard state for this session."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="lg" className="rounded-full text-sm">
                  <PanelLeft className="h-4 w-4 text-[var(--accent)]" />
                  2-column layout
                </Button>
                <Button
                  onClick={() => void handleExport()}
                  variant="outline"
                  size="lg"
                  className="rounded-full text-sm"
                >
                  <Download className="h-4 w-4 text-[var(--accent)]" />
                  Export PDF
                </Button>
              </div>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {loading
              ? Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
              : snapshot?.kpis.map((kpi) => <KpiCard key={kpi.id} {...kpi} />)}
          </section>

          <section className="shell-panel panel-enter rounded-[28px] p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                  Agent ticker
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  {loading
                    ? "Connecting to the session and pulling the latest state."
                    : snapshot?.messages.at(-1)?.content ?? "Workspace ready."}
                </p>
              </div>
              <Badge variant="secondary" className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-[var(--accent)]">
                {loading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
                {visibleStatus}
              </Badge>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {loading
              ? Array.from({ length: 4 }).map((_, index) => <PanelSkeleton key={index} />)
              : snapshot?.panels.map((panel) => <PanelCard key={panel.id} panel={panel} />)}
          </section>

          <section className="shell-panel panel-enter rounded-[28px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                  Insight rail
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Proactive notes generated from the first pass through the data.
                </p>
              </div>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
                {snapshot?.lastUpdatedAt
                  ? new Date(snapshot.lastUpdatedAt).toLocaleTimeString()
                  : "Updating..."}
              </Badge>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {(snapshot?.insights ?? []).map((insight) => (
                <Card
                  key={insight}
                  className="rounded-2xl border-[var(--border)] bg-white p-0 shadow-none transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <CardContent className="p-4">
                    <div className="mb-3 h-1.5 w-10 rounded-full bg-[var(--accent)]" />
                    <p className="text-sm leading-6 text-[var(--foreground)]">{insight}</p>
                    <Button
                      onClick={() => setQuery(insight)}
                      variant="ghost"
                      className="mt-4 h-auto px-0 py-0 text-xs font-medium text-[var(--accent)] hover:bg-transparent"
                    >
                      Ask about this
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        </section>

        <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <CopilotPanel
            snapshot={snapshot}
            loading={loading}
            query={query}
            setQuery={setQuery}
            submitting={submitting}
            submitQuery={submitQuery}
            voiceActive={voiceActive}
            startVoiceCapture={startVoiceCapture}
          />
        </aside>
      </div>
    </main>
  );
}

function KpiCard({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: string;
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--success)]"
      : tone === "warning"
        ? "text-[var(--warning)]"
        : "text-[var(--text-secondary)]";

  return (
    <Card className="shell-panel panel-enter rounded-[24px] border-[var(--border)] bg-white/90 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]">
          {label}
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
            {value || "-"}
          </p>
          <p className={cn("text-xs font-medium", toneClass)}>{delta}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return <Skeleton className="h-[110px] rounded-[24px] border border-[var(--border)]" />;
}

function PanelSkeleton() {
  return (
    <article className="shell-panel rounded-[24px] p-4">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="h-7 w-2/3 rounded-full" />
        <Skeleton className="h-40 rounded-[20px]" />
      </div>
    </article>
  );
}

function PanelCard({ panel }: { panel: DashboardPanel }) {
  return (
    <Card className="shell-panel panel-enter rounded-[26px] border-[var(--border)] bg-white shadow-none">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 sm:p-5">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-[var(--foreground)]">{panel.title}</CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--text-secondary)]">
            {panel.description}
          </CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Ask about this</DropdownMenuItem>
            <DropdownMenuItem>Regenerate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[var(--danger)] focus:text-[var(--danger)]">Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="rounded-[20px] border border-[var(--border)] bg-[linear-gradient(180deg,#ffffff,#fbfaf8)] p-4">
        {panel.kind === "plotly" ? (
          <Plot
            data={panel.spec.data}
            layout={{
              autosize: true,
              font: {
                family: "var(--font-geist-sans)",
                color: "#6b6966",
              },
              paper_bgcolor: "rgba(0,0,0,0)",
              plot_bgcolor: "rgba(0,0,0,0)",
              ...panel.spec.layout,
            }}
            config={{
              displayModeBar: false,
              responsive: true,
              ...panel.spec.config,
            }}
            useResizeHandler
            style={{ width: "100%", height: "320px" }}
          />
        ) : panel.kind === "table" ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                  {panel.columns.map((column) => (
                    <th key={column} className="px-2 py-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {panel.rows.map((row, index) => (
                  <tr
                    key={index}
                    className="border-b border-[var(--border)] last:border-none"
                  >
                    {panel.columns.map((column) => (
                      <td key={column} className="px-2 py-3 text-[var(--foreground)]">
                        {String(row[column] ?? "-")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <iframe
            title={panel.title}
            sandbox="allow-same-origin"
            srcDoc={`<!DOCTYPE html><html><body style="margin:0;font-family:Inter,system-ui,sans-serif;background:#fff;color:#111110;">${panel.html}</body></html>`}
            className="h-[320px] w-full rounded-[18px] border-0 bg-white"
          />
        )}
      </CardContent>

      {panel.insight ? (
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{panel.insight}</p>
      ) : null}
    </Card>
  );
}

function CopilotPanel({
  snapshot,
  loading,
  query,
  setQuery,
  submitting,
  submitQuery,
  voiceActive,
  startVoiceCapture,
}: {
  snapshot: DashboardState | null;
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  submitting: boolean;
  submitQuery: () => Promise<void>;
  voiceActive: boolean;
  startVoiceCapture: () => void;
}) {
  return (
    <Card className="shell-panel panel-enter flex h-full flex-col rounded-[30px] border-[var(--border)] bg-white shadow-none">
      <CardHeader className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]">
              Copilot
            </p>
            <CardTitle className="mt-1 flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
              <Bot className="h-4 w-4 text-[var(--accent)]" />
              Viewpilot
            </CardTitle>
          </div>
          <Button size="lg" className="rounded-full text-sm">
            Export PDF
            <Download className="h-4 w-4" />
          </Button>
        </div>
        <Separator className="bg-[var(--border)]" />
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-0 sm:p-5 sm:pt-0">
        <Card className="border-[var(--border)] bg-[rgba(238,242,255,0.6)] shadow-none">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              Session state
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">
              {loading
                ? "Loading the latest session snapshot."
                : snapshot?.messages.at(-1)?.content ?? "Ready for your next prompt."}
            </p>
            <Badge variant="secondary" className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-[var(--accent)]">
              <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              {loading ? "Syncing dashboard" : "Ready for prompts"}
            </Badge>
          </CardContent>
        </Card>

        <ScrollArea className="min-h-0 flex-1 pr-1">
          <div className="space-y-3">
            {(snapshot?.messages ?? []).map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {submitting ? <StreamingPulse /> : null}
          </div>
        </ScrollArea>

        <Card className="border-[var(--border)] bg-white shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              <Mic className={cn("h-3.5 w-3.5", voiceActive && "text-[var(--accent)]")} />
              Voice or text
            </div>
            <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Compare Q1 vs Q2, find the strongest segment, or ask for a custom card."
                className="min-h-28 w-full resize-none rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
              />
              <div className="mt-3 flex items-center gap-2">
                <Button
                  onClick={startVoiceCapture}
                  type="button"
                  variant={voiceActive ? "secondary" : "outline"}
                  size="lg"
                  className="rounded-full text-sm"
                >
                  <Mic className="h-4 w-4" />
                  {voiceActive ? "Listening..." : "Voice"}
                </Button>
                <Button
                  onClick={() => void submitQuery()}
                  disabled={!query.trim() || submitting}
                  size="lg"
                  className="rounded-full text-sm"
                >
                  {submitting ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <SendHorizonal className="h-4 w-4" />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}

function MessageBubble({
  message,
}: {
  message: DashboardState["messages"][number];
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[88%] rounded-[22px] bg-[var(--accent-soft)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">
        {message.content}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-[22px] border border-[var(--border)] bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
        <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
        {message.role === "assistant" ? "Assistant" : "System"}
      </div>
      <p className="text-sm leading-6 text-[var(--foreground)]">{message.content}</p>
      {message.code ? (
        <pre className="overflow-x-auto rounded-[18px] bg-[#141414] p-4 text-xs leading-6 text-[#f3f3f3]">
          <code>{message.code}</code>
        </pre>
      ) : null}
    </div>
  );
}

function StreamingPulse() {
  return (
    <div className="rounded-[22px] border border-[var(--border)] bg-white px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
        <div className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
        Streaming
      </div>
      <div className="mt-3 space-y-2">
        <div className="skeleton h-3 w-3/4 rounded-full" />
        <div className="skeleton h-3 w-2/3 rounded-full" />
        <div className="skeleton h-3 w-1/2 rounded-full" />
      </div>
    </div>
  );
}
