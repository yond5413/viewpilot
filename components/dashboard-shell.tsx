"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronRight,
  CircleDot,
  Download,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  SendHorizonal,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AnalysisStreamEvent, DashboardPanel, DashboardState } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardDescription,
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
import { cn } from "./cn";
import { fetchDashboardState } from "./dashboard-data";

type PlotProps = {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  useResizeHandler?: boolean;
  style?: CSSProperties;
};

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false }) as ComponentType<PlotProps>;

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

type SpeechRecognitionResultLike = { transcript?: string };
type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
};
type SpeechRecognitionWithWebkit = typeof window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

const stagger = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.07, delayChildren: 0.05 },
    },
  },
  item: {
    hidden: { opacity: 0, y: 12 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 280, damping: 28 },
    },
  },
};

const EMPTY_CELL = "—";

const formatDisplayValue = (value: unknown) => {
  if (value == null) {
    return EMPTY_CELL;
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      notation: Math.abs(value) >= 1000 ? "compact" : "standard",
      maximumFractionDigits: Math.abs(value) >= 1000 ? 2 : 1,
    }).format(value);
  }

  const text = String(value).trim();
  return text || EMPTY_CELL;
};

export function DashboardShell({ sessionId }: DashboardShellProps) {
  const [snapshot, setSnapshot] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [streamEvents, setStreamEvents] = useState<AnalysisStreamEvent[]>([]);

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
    const intervalId = window.setInterval(syncState, 20000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [sessionId]);

  const visibleStatus = useMemo(() => {
    if (loading) return "Preparing dashboard…";
    return snapshot?.status || "Ready";
  }, [loading, snapshot?.status]);

  useEffect(() => {
    if (!submitting) {
      return;
    }

    const eventSource = new EventSource(`/api/query-stream/${encodeURIComponent(sessionId)}`);
    eventSource.addEventListener("progress", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as AnalysisStreamEvent;
        setStreamEvents((current) => [...current, payload].slice(-24));
      } catch {
        // Ignore malformed progress events.
      }
    });
    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, [sessionId, submitting]);

  const submitQuery = async () => {
    if (!query.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    setStreamEvents([]);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt: query.trim() }),
      });

      const payload = (await response.json()) as DashboardState | { error?: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "The query request failed.",
        );
      }

      setSnapshot(payload as DashboardState);
      setQuery("");
    } catch (queryError) {
      setError(
        queryError instanceof Error ? queryError.message : "Unable to run the copilot query.",
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
      headers: { "Content-Type": "application/json" },
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
    <main className="noise-overlay relative min-h-screen overflow-hidden px-4 py-4 sm:px-5 lg:px-6">
      {/* Background blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Top spotlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#6366f1] to-transparent opacity-50" />
        <div className="absolute left-1/2 -top-32 h-64 w-[50%] -translate-x-1/2 rounded-full bg-[#6366f1] opacity-[0.08] blur-[80px]" />
        {/* Blobs */}
        <div className="animate-blob absolute -left-60 -top-60 h-[700px] w-[700px] rounded-full bg-[#6366f1] opacity-[0.10] blur-[120px]" />
        <div className="animate-blob-delay absolute -right-60 bottom-0 h-[500px] w-[500px] rounded-full bg-[#8b5cf6] opacity-[0.07] blur-[100px]" />
        <div className="dot-grid absolute inset-0" />
      </div>

      <div className="relative mx-auto grid w-full max-w-[1400px] gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Main column */}
        <section className="min-w-0 space-y-5">
          {/* Header */}
          <motion.header
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="glass-card rounded-[24px] px-5 py-4 sm:px-6"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="inline-flex items-center gap-1.5 rounded-full border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]"
                  >
                    <Sparkles className="h-3 w-3" />
                    Session {sessionId.slice(0, 8)}…
                  </Badge>
                  <Badge
                    variant="outline"
                    className="inline-flex items-center gap-1.5 rounded-full border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                  >
                    <CircleDot className="h-3 w-3 text-[var(--success)]" />
                    {snapshot?.filename ?? "Awaiting source"}
                  </Badge>
                </div>
                <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
                  {snapshot?.profile?.filename ?? "Analytics workspace"}
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                  {snapshot?.profile
                    ? `${snapshot.profile.rows.toLocaleString()} rows · ${snapshot.profile.columns} columns · ${snapshot.profile.numericColumns.length} numeric fields`
                    : "Loading dashboard state for this session."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void handleExport()}
                  variant="outline"
                  size="sm"
                  className="rounded-full border-[var(--border-strong)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Export PDF
                </Button>
              </div>
            </div>
          </motion.header>

          {/* KPI cards */}
          <motion.section
            variants={stagger.container}
            initial="hidden"
            animate="show"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            {loading
              ? Array.from({ length: 4 }).map((_, index) => <KpiSkeleton key={index} />)
              : snapshot?.kpis.map((kpi) => (
                  <motion.div key={kpi.id} variants={stagger.item}>
                    <KpiCard {...kpi} />
                  </motion.div>
                ))}
          </motion.section>

          {/* Agent ticker */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="glass-card rounded-[20px] px-5 py-4"
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-muted)]">
                  Agent ticker
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  {loading
                    ? "Connecting to session and pulling latest state."
                    : snapshot?.messages.at(-1)?.content ?? "Workspace ready."}
                </p>
              </div>
              <Badge
                variant="outline"
                className="inline-flex w-fit items-center gap-2 rounded-full border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)]"
              >
                {loading ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
                )}
                {visibleStatus}
              </Badge>
            </div>
          </motion.section>

          {/* Chart panels */}
          <motion.section
            variants={stagger.container}
            initial="hidden"
            animate="show"
            className="grid gap-4 lg:grid-cols-2"
          >
            {loading
              ? Array.from({ length: 4 }).map((_, index) => (
                  <motion.div key={index} variants={stagger.item}>
                    <PanelSkeleton />
                  </motion.div>
                ))
              : snapshot?.panels.map((panel) => (
                  <motion.div key={panel.id} variants={stagger.item}>
                    <PanelCard panel={panel} />
                  </motion.div>
                ))}
          </motion.section>

          {/* Insights */}
          {(snapshot?.insights ?? []).length > 0 ? (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="glass-card rounded-[24px] p-5 sm:p-6"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-muted)]">
                    Insight rail
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    Proactive notes generated from the first pass through the data.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                >
                  {snapshot?.lastUpdatedAt
                    ? new Date(snapshot.lastUpdatedAt).toLocaleTimeString()
                    : "Updating…"}
                </Badge>
              </div>

              <motion.div
                variants={stagger.container}
                initial="hidden"
                animate="show"
                className="mt-5 grid gap-3 lg:grid-cols-3"
              >
                {(snapshot?.insights ?? []).map((insight) => (
                  <motion.div
                    key={insight}
                    variants={stagger.item}
                    whileHover={{ y: -3, transition: { type: "spring", stiffness: 400 } }}
                    className="glass-panel cursor-default rounded-2xl p-4"
                  >
                    <div className="mb-3 h-1 w-8 rounded-full bg-gradient-to-r from-[var(--accent)] to-[#a78bfa]" />
                    <p className="text-sm leading-6 text-[var(--foreground)]">{insight}</p>
                    <button
                      onClick={() => setQuery(insight)}
                      className="mt-4 flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      Ask about this
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </motion.div>
                ))}
              </motion.div>
            </motion.section>
          ) : null}

          <AnimatePresence>
            {error ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm text-[var(--danger)]"
              >
                {error}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </section>

        {/* Copilot sidebar */}
        <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
          <CopilotPanel
            snapshot={snapshot}
            loading={loading}
            query={query}
            setQuery={setQuery}
            submitting={submitting}
            streamEvents={streamEvents}
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
  const TrendIcon =
    tone === "positive" ? TrendingUp : tone === "warning" ? TrendingDown : Minus;
  const toneColor =
    tone === "positive"
      ? "text-[var(--success)]"
      : tone === "warning"
        ? "text-[var(--danger)]"
        : "text-[var(--text-muted)]";

  return (
    <motion.div
      whileHover={{ y: -2, transition: { type: "spring", stiffness: 400 } }}
      className="glass-panel rounded-[20px] p-4 sm:p-5"
    >
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-[clamp(1.85rem,2.6vw,2.75rem)] font-semibold leading-none tracking-tight text-[var(--foreground)]">
          {formatDisplayValue(value)}
        </p>
        {delta ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs font-medium",
              toneColor,
            )}
          >
            <TrendIcon className="h-3.5 w-3.5" />
            {delta}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function KpiSkeleton() {
  return <div className="skeleton h-[108px] rounded-[20px]" />;
}

function PanelSkeleton() {
  return (
    <div className="glass-card rounded-[24px] p-4">
      <div className="space-y-3">
        <div className="skeleton h-3.5 w-20 rounded-full" />
        <div className="skeleton h-6 w-2/3 rounded-full" />
        <div className="skeleton h-44 rounded-[18px]" />
      </div>
    </div>
  );
}

function PanelCard({ panel }: { panel: DashboardPanel }) {
  return (
    <motion.div
      whileHover={{ y: -2, transition: { type: "spring", stiffness: 400 } }}
      className="glass-card rounded-[24px]"
    >
      <div className="flex flex-row items-start justify-between gap-3 p-4 sm:p-5">
        <div className="space-y-1">
          <CardTitle className="text-base font-semibold text-[var(--foreground)]">
            {panel.title}
          </CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--text-secondary)]">
            {panel.description}
          </CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-[var(--text-muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border-[var(--border)] bg-[var(--popover)] text-[var(--foreground)]"
          >
            <DropdownMenuItem>Ask about this</DropdownMenuItem>
            <DropdownMenuItem>Regenerate</DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[var(--border)]" />
            <DropdownMenuItem className="text-[var(--danger)] focus:text-[var(--danger)]">
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mx-4 mb-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3">
        {panel.kind === "plotly" ? (
          <Plot
            data={panel.spec.data}
            layout={{
              autosize: true,
              font: { family: "Inter, sans-serif", color: "#71717a", size: 11 },
              paper_bgcolor: "rgba(0,0,0,0)",
              plot_bgcolor: "rgba(0,0,0,0)",
              margin: { t: 24, r: 12, b: 36, l: 36 },
              xaxis: {
                gridcolor: "rgba(255,255,255,0.06)",
                zerolinecolor: "rgba(255,255,255,0.08)",
              },
              yaxis: {
                gridcolor: "rgba(255,255,255,0.06)",
                zerolinecolor: "rgba(255,255,255,0.08)",
              },
              ...panel.spec.layout,
            }}
            config={{ displayModeBar: false, responsive: true, ...panel.spec.config }}
            useResizeHandler
            style={{ width: "100%", height: "280px" }}
          />
        ) : panel.kind === "table" ? (
          <ScrollArea className="max-h-[320px] w-full">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  {panel.columns.map((column) => (
                    <th
                      key={column}
                      className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {panel.rows.map((row, index) => (
                  <tr
                    key={index}
                    className="border-b border-[var(--border)] last:border-none hover:bg-[var(--card)]"
                  >
                    {panel.columns.map((column) => (
                      <td key={column} className="px-3 py-2 text-[var(--foreground)]">
                        {String(row[column] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <iframe
            title={panel.title}
            sandbox="allow-same-origin"
            srcDoc={`<!DOCTYPE html><html><body style="margin:0;font-family:Inter,system-ui,sans-serif;background:transparent;color:#f2f2f3;">${panel.html}</body></html>`}
            className="h-[280px] w-full rounded-[14px] border-0 bg-transparent"
          />
        )}
      </div>

      {panel.insight ? (
        <p className="px-4 pb-4 text-sm leading-6 text-[var(--text-secondary)]">
          {panel.insight}
        </p>
      ) : null}
    </motion.div>
  );
}

function CopilotPanel({
  snapshot,
  loading,
  query,
  setQuery,
  submitting,
  streamEvents,
  submitQuery,
  voiceActive,
  startVoiceCapture,
}: {
  snapshot: DashboardState | null;
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  submitting: boolean;
  streamEvents: AnalysisStreamEvent[];
  submitQuery: () => Promise<void>;
  voiceActive: boolean;
  startVoiceCapture: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [snapshot?.messages.length, submitting]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
      className="glass-panel flex h-full flex-col rounded-[28px]"
    >
      {/* Header */}
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-muted)]">
              Copilot
            </p>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <Bot className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">Viewpilot</h2>
            </div>
          </div>
          <Button
            size="sm"
            className="rounded-full bg-[var(--accent)] text-xs text-white hover:bg-indigo-500"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
        <div className="border-t border-[var(--border)]" />
      </div>

      {/* Status bubble */}
      <div className="px-4 sm:px-5">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-3">
          <p className="text-xs text-[var(--text-secondary)]">
            {loading
              ? "Loading the latest session snapshot."
              : submitting && streamEvents.length > 0
                ? streamEvents.at(-1)?.message
                : submitting
                  ? "Working through the analysis plan and validating results."
                  : snapshot?.messages.at(-1)?.content ?? "Ready for your next prompt."}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--accent)]">
            <div
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-[var(--accent)]",
                loading && "animate-pulse",
              )}
            />
            {loading
              ? "Syncing dashboard"
              : submitting
                ? streamEvents.at(-1)?.stage?.replace(/_/g, " ") || "Running analysis"
                : "Ready for prompts"}
          </div>
        </div>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-2 sm:px-5">
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {(snapshot?.messages ?? []).map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <MessageBubble message={message} />
              </motion.div>
            ))}
            {submitting ? (
              <motion.div
                key="streaming"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <StreamingPulse events={streamEvents} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Input */}
      <div className="mt-2 p-4 sm:p-5">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1">
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                void submitQuery();
              }
            }}
            placeholder="Compare Q1 vs Q2, find the strongest segment…"
            className="min-h-20 w-full resize-none rounded-xl bg-transparent px-3 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button
                onClick={startVoiceCapture}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "rounded-full text-xs",
                  voiceActive
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
                )}
              >
                <Mic className="h-3.5 w-3.5" />
                {voiceActive ? "Listening…" : "Voice"}
              </Button>
            </motion.div>
            <div className="flex-1" />
            <p className="text-xs text-[var(--text-muted)]">⌘↵ to send</p>
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Button
                onClick={() => void submitQuery()}
                disabled={!query.trim() || submitting}
                size="sm"
                className="rounded-full bg-[var(--accent)] text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                {submitting ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SendHorizonal className="h-3.5 w-3.5" />
                )}
                Send
              </Button>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function MessageBubble({ message }: { message: DashboardState["messages"][number] }) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-4 py-2.5 text-sm leading-6 text-white">
        {message.content}
      </div>
    );
  }

  return (
    <div className="glass-card space-y-3 rounded-2xl rounded-bl-sm px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
        <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
        {message.role === "assistant" ? "Assistant" : "System"}
      </div>
      <p className="text-sm leading-6 text-[var(--foreground)]">{message.content}</p>
      {message.code ? (
        <pre className="overflow-x-auto rounded-xl bg-[#0d0d0e] p-4 text-xs leading-6 text-[#c4c4c8]">
          <code>{message.code}</code>
        </pre>
      ) : null}
    </div>
  );
}

function StreamingPulse({ events }: { events: AnalysisStreamEvent[] }) {
  return (
    <div className="glass-card rounded-2xl rounded-bl-sm px-4 py-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
        <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
        Streaming
      </div>
      {events.length > 0 ? (
        <div className="space-y-2">
          {events.slice(-4).map((event) => (
            <div key={event.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {(event.stage || "progress").replace(/_/g, " ")}
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--foreground)]">{event.message}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {[75, 60, 45].map((w) => (
            <div key={w} className="skeleton h-2.5 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}
