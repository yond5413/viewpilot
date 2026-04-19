"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronRight,
  CircleDot,
  Download,
  Eye,
  LoaderCircle,
  Mic,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
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

const prettifyText = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\boutlay amount\b/gi, "Outlay")
    .replace(/\bobligated amount\b/gi, "Obligated")
    .replace(/\bbudget authority amount\b/gi, "Budget Authority")
    .replace(/\bactive agency name\b/gi, "Agency Count")
    .replace(/\s+/g, " ")
    .trim();

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

  const text = prettifyText(String(value));
  if (/^-?\d+(?:\.\d+)?%$/.test(text)) {
    return text;
  }
  if (/^\$?-?\d+(?:\.\d+)?[KMBT]$/i.test(text)) {
    return text.toUpperCase();
  }
  return text || EMPTY_CELL;
};

const formatProgressMessage = (event: AnalysisStreamEvent) => {
  if (event.type === "stage_started") {
    switch (event.stage) {
      case "session_context":
        return "Loading the current dashboard context.";
      case "route":
        return "Interpreting your request and choosing the right analysis path.";
      case "task_spec":
        return "Planning the KPI package and chart updates.";
      case "codegen":
        return "Drafting the analysis steps inside the sandbox.";
      case "sandbox_execution":
        return "Running the analysis in the sandbox.";
      case "sandbox_result_parse":
        return "Parsing the sandbox result into dashboard artifacts.";
      case "validation":
        return "Checking KPI and chart quality.";
      case "critic":
        return "Reviewing the update for readability and usefulness.";
      case "mutation":
        return "Composing the dashboard update.";
      case "persist":
        return "Saving the updated dashboard state.";
      default:
        return event.message;
    }
  }

  if (event.type === "stage_warning") {
    return `Watchout: ${event.message}`;
  }

  if (event.type === "analysis_complete") {
    return "Analysis complete. Syncing the final dashboard.";
  }

  return event.message;
};

export function DashboardShell({ sessionId }: DashboardShellProps) {
  const [snapshot, setSnapshot] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const voiceTranscriptRef = useRef("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [streamEvents, setStreamEvents] = useState<AnalysisStreamEvent[]>([]);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);

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
  const previewColumns = snapshot?.profile?.sampleRows[0]
    ? Object.keys(snapshot.profile.sampleRows[0])
    : [];

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

  const submitQuery = async (overridePrompt?: string) => {
    const nextPrompt = overridePrompt ?? query.trim();
    if (!nextPrompt || submitting) return;
    setSubmitting(true);
    setError(null);
    setStreamEvents([]);

    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, prompt: nextPrompt }),
      });

      const payload = (await response.json()) as DashboardState | { error?: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "The query request failed.",
        );
      }

      setSnapshot(payload as DashboardState);
      if (!overridePrompt) {
        setQuery("");
      }
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

    recognition.onstart = () => {
      voiceTranscriptRef.current = "";
      setVoiceActive(true);
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join("");
      voiceTranscriptRef.current = transcript;
      setQuery(transcript);
    };
    recognition.onend = () => {
      setVoiceActive(false);
      const captured = voiceTranscriptRef.current.trim();
      if (captured) {
        void submitQuery(captured);
      }
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

      <div className="relative mx-auto flex w-full max-w-[1400px] items-start gap-5">
        {/* Main column */}
        <section className="min-w-0 flex-1 space-y-5">
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
                  onClick={() => setShowDataPreview(true)}
                  variant="outline"
                  size="sm"
                  className="rounded-full border-[var(--border-strong)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                >
                  <Eye className="h-3.5 w-3.5 text-[var(--accent)]" />
                  View data
                </Button>
                <Button
                  onClick={() => void handleExport()}
                  variant="outline"
                  size="sm"
                  className="rounded-full border-[var(--border-strong)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Export PDF
                </Button>
                <Button
                  onClick={() => setCopilotOpen((v) => !v)}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "rounded-full border-[var(--border-strong)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]",
                    copilotOpen && "border-[var(--accent)]/60 bg-[var(--accent-soft)] text-[var(--accent)]",
                  )}
                >
                  {copilotOpen ? (
                    <PanelRightClose className="h-3.5 w-3.5" />
                  ) : (
                    <PanelRightOpen className="h-3.5 w-3.5" />
                  )}
                  Copilot
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
                    <PanelCard
                      panel={panel}
                      onQuickAction={(prompt) => {
                        setQuery(prompt);
                        void submitQuery(prompt);
                      }}
                    />
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
                    The strongest analyst notes and next-step opportunities from the current dataset.
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
                {(snapshot?.insights ?? []).slice(0, 3).map((insight) => (
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
          ) : !loading ? (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="glass-card rounded-[24px] p-5 sm:p-6"
            >
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-muted)]">
                Insight rail
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                This dataset needs a more specific prompt before the system can surface stronger insights. Try asking for a ranking, a distribution view, or a data-quality check.
              </p>
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
        <AnimatePresence initial={false}>
          {copilotOpen ? (
            <motion.aside
              key="copilot-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 380, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
              className="hidden shrink-0 overflow-hidden lg:flex lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:flex-col"
            >
              <div className="flex h-full min-h-0 w-[380px] flex-col">
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
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showDataPreview && snapshot?.profile ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setShowDataPreview(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="glass-card max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-muted)]">
                    Data preview
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-[var(--foreground)]">
                    {snapshot.profile.filename}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {snapshot.profile.rows.toLocaleString()} rows, {snapshot.profile.columns} columns. Read-only sample of the uploaded data.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowDataPreview(false)}>
                  Close
                </Button>
              </div>
              <div className="grid gap-4 border-b border-[var(--border)] px-5 py-4 md:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-3">
                    <div className="rounded-2xl border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      Column overview
                    </p>
                    <div className="mt-3 space-y-2">
                      {snapshot.profile.columnsByType.slice(0, 8).map((column) => (
                        <div key={column.name} className="flex items-center justify-between gap-3 text-sm">
                          <span className="truncate text-[var(--foreground)]">{formatDisplayValue(column.name)}</span>
                          <span className="shrink-0 text-[var(--text-muted)]">{column.inferredType}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-4">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Sample rows
                  </p>
                  <ScrollArea className="mt-3 max-h-[50vh] w-full">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                          {previewColumns.map((column) => (
                            <th key={column} className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]">
                              {formatDisplayValue(column)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.profile.sampleRows.map((row, index) => (
                          <tr key={index} className="border-b border-[var(--border)] last:border-none">
                            {previewColumns.map((column) => (
                              <td key={column} className="px-3 py-2 text-[var(--foreground)]">
                                {formatDisplayValue(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
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
      className="glass-panel h-[118px] rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-4 sm:p-5"
    >
      <p className="line-clamp-2 min-h-[2.4rem] text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {label}
      </p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[clamp(1.7rem,2.2vw,2.4rem)] font-semibold leading-none tracking-tight text-[var(--foreground)]">
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

function PanelCard({
  panel,
  onQuickAction,
}: {
  panel: DashboardPanel;
  onQuickAction: (prompt: string) => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -2, transition: { type: "spring", stiffness: 400 } }}
      className="glass-card rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))]"
    >
      <div className="flex flex-row items-start justify-between gap-3 p-4 sm:p-5">
        <div className="space-y-1.5">
          <CardTitle className="text-base font-semibold text-[var(--foreground)]">
            {panel.title}
          </CardTitle>
          <CardDescription className="line-clamp-2 text-sm leading-6 text-[var(--text-secondary)]">
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
              <DropdownMenuItem onClick={() => onQuickAction(`Explain the panel titled "${panel.title}" and tell me what matters most.`)}>
                Ask about this
              </DropdownMenuItem>
              {panel.kind === "plotly" ? (
                <>
                  <DropdownMenuItem onClick={() => onQuickAction(`Convert the panel titled "${panel.title}" to a bar chart.`)}>
                    Convert to bar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onQuickAction(`Convert the panel titled "${panel.title}" to a pie chart if that would be a truthful composition view.`)}>
                    Convert to pie
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onQuickAction(`Convert the panel titled "${panel.title}" to a table.`)}>
                    Convert to table
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuItem onClick={() => onQuickAction(`Replace the panel titled "${panel.title}" with a stronger view that better answers the current dashboard question.`)}>
                Replace panel
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--border)]" />
              <DropdownMenuItem className="text-[var(--danger)] focus:text-[var(--danger)]">
                Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mx-4 mb-4 rounded-[18px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
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
  submitQuery: (overridePrompt?: string) => Promise<void>;
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
      className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))]"
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

      {/* Message list */}
      <div ref={scrollRef} className="mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-2 sm:px-5">
        {!loading && (snapshot?.messages ?? []).length === 0 && !submitting ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
              <Sparkles className="h-5 w-5 text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Ask anything about your data</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {snapshot?.profile
                  ? `${snapshot.profile.rows.toLocaleString()} rows · ${snapshot.profile.columns} columns loaded`
                  : "Upload a CSV to get started"}
              </p>
            </div>
            {(snapshot?.suggestedPrompts?.length ?? 0) > 0 ? (
              <div className="grid w-full gap-2">
                {snapshot?.suggestedPrompts.slice(0, 3).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => void submitQuery(prompt)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent)]/60 hover:bg-[var(--accent-soft)] hover:text-[var(--foreground)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
        <div className="space-y-4">
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
        )}
        {snapshot?.analysisState.pendingClarification ? (
          <div className="mt-4 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Clarify intent
            </p>
            <div className="grid gap-2">
              {snapshot.analysisState.pendingClarification.options.map((option) => {
                const recommended = option.id === snapshot.analysisState.pendingClarification?.recommendedOptionId;
                return (
                  <button
                    key={option.id}
                    onClick={() => void submitQuery(option.id)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left transition",
                      recommended
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/70",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-[var(--foreground)]">
                        {option.id}) {option.label}
                      </p>
                      {recommended ? (
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                          Recommended
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* Input */}
      <div className="p-4 sm:p-5">
        {/* Follow-up chips — only after first message */}
        {!submitting && !snapshot?.analysisState.pendingClarification && (snapshot?.messages?.length ?? 0) > 0 && (snapshot?.suggestedPrompts?.length ?? 0) > 0 ? (
          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {snapshot?.suggestedPrompts.slice(0, 4).map((prompt) => (
              <button
                key={prompt}
                onClick={() => void submitQuery(prompt)}
                className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--accent)]/60 hover:bg-[var(--accent-soft)] hover:text-[var(--foreground)]"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        {/* Command bar */}
        <div className={cn(
          "rounded-2xl border bg-[var(--surface)] transition-colors",
          voiceActive
            ? "border-[var(--accent)]/60 ring-2 ring-[var(--accent)]/15"
            : "border-[var(--border-strong)] focus-within:border-[var(--accent)]/60 focus-within:ring-2 focus-within:ring-[var(--accent)]/10",
        )}>
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                void submitQuery();
              }
            }}
            placeholder={voiceActive ? "Listening…" : "Ask about your data — trends, outliers, segments…"}
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-1">
            <button
              onClick={startVoiceCapture}
              disabled={submitting}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40",
                voiceActive
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--card)] hover:text-[var(--foreground)]",
              )}
            >
              <Mic className="h-3 w-3" />
              {voiceActive ? "Listening" : "Voice"}
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-[var(--text-muted)] opacity-60">⌘↵</span>
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void submitQuery()}
              disabled={(!query.trim() && !voiceActive) || submitting}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full transition disabled:opacity-30",
                query.trim() || voiceActive
                  ? "bg-[var(--accent)] text-white hover:bg-indigo-500"
                  : "bg-[var(--border)] text-[var(--text-muted)]",
              )}
            >
              {submitting ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SendHorizonal className="h-3.5 w-3.5" />
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const CONTENT_TRUNCATE_CHARS = 320;

function MessageBubble({ message }: { message: DashboardState["messages"][number] }) {
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-[4px] bg-[var(--accent)] px-4 py-2.5 text-sm leading-[1.65] text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const content = message.content ?? "";
  const isTruncatable = content.length > CONTENT_TRUNCATE_CHARS;
  const visibleContent = isTruncatable && !bodyExpanded
    ? content.slice(0, CONTENT_TRUNCATE_CHARS).trimEnd() + "…"
    : content;

  const lineCount = message.code ? message.code.split("\n").length : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)]">
          <Sparkles className="h-3 w-3 text-[var(--accent)]" />
        </div>
        <span className="text-[11px] font-semibold text-[var(--accent)]">Viewpilot</span>
        {message.createdAt ? (
          <span className="text-[10px] text-[var(--text-muted)]">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
      <div className="rounded-2xl rounded-tl-[4px] border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-[1.7] text-[var(--foreground)]">
          {visibleContent}
        </p>
        {isTruncatable ? (
          <button
            onClick={() => setBodyExpanded((v) => !v)}
            className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
          >
            {bodyExpanded ? "Show less" : "Show more"}
          </button>
        ) : null}
        {message.code ? (
          <div className="mt-3">
            <button
              onClick={() => setCodeExpanded((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", codeExpanded && "rotate-90")} />
              Python · {lineCount} line{lineCount !== 1 ? "s" : ""}
            </button>
            {codeExpanded ? (
              <pre className="mt-2 overflow-x-auto rounded-xl bg-[#0d0d0e] p-4 text-xs leading-6 text-[#c4c4c8]">
                <code>{message.code}</code>
              </pre>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const PIPELINE_STEPS: { key: string; label: string; stages: string[] }[] = [
  { key: "route", label: "Route", stages: ["session_context", "route"] },
  { key: "plan", label: "Plan", stages: ["task_spec"] },
  { key: "code", label: "Code", stages: ["codegen"] },
  { key: "run", label: "Run", stages: ["sandbox_execution", "sandbox_result_parse"] },
  { key: "review", label: "Review", stages: ["validation", "critic", "mutation", "persist"] },
];

function StreamingPulse({ events }: { events: AnalysisStreamEvent[] }) {
  const latestEvent = events.at(-1);
  const activeStepIndex = latestEvent?.stage
    ? PIPELINE_STEPS.findIndex((step) => step.stages.includes(latestEvent.stage ?? ""))
    : -1;
  const message = latestEvent ? formatProgressMessage(latestEvent) : "Preparing your analysis…";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--accent-soft)]">
          <LoaderCircle className="h-3 w-3 animate-spin text-[var(--accent)]" />
        </div>
        <span className="text-[11px] font-semibold text-[var(--accent)]">Viewpilot</span>
        <span className="text-[10px] text-[var(--text-muted)]">working…</span>
      </div>

      <div className="rounded-2xl rounded-tl-[4px] border border-[var(--accent)]/20 bg-[var(--card)] px-4 py-3">
        {/* Pipeline */}
        <div className="mb-3 flex items-center gap-1">
          {PIPELINE_STEPS.map((step, i) => {
            const done = activeStepIndex > i;
            const active = activeStepIndex === i;
            return (
              <div key={step.key} className="flex items-center gap-1">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full transition-all duration-300",
                      done
                        ? "bg-[var(--accent)]"
                        : active
                          ? "animate-pulse bg-[var(--accent)] ring-2 ring-[var(--accent)]/25"
                          : "bg-[var(--border-strong)]",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[9px] font-medium uppercase tracking-[0.08em]",
                      done || active ? "text-[var(--accent)]" : "text-[var(--text-muted)]",
                    )}
                  >
                    {step.label}
                  </span>
                </div>
                {i < PIPELINE_STEPS.length - 1 ? (
                  <div
                    className={cn(
                      "mb-3.5 h-px w-5 transition-all duration-500",
                      done ? "bg-[var(--accent)]" : "bg-[var(--border)]",
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Current message */}
        <p className="text-sm leading-[1.7] text-[var(--text-secondary)]">
          {message}
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[1px] animate-pulse rounded-full bg-[var(--accent)] align-middle" />
        </p>
      </div>
    </div>
  );
}
