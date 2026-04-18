"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CloudUpload,
  Database,
  FileText,
  LoaderCircle,
  Sparkles,
  WandSparkles,
  Zap,
  Shield,
  MessageSquare,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "./cn";

const demoSource = {
  kind: "api",
  label: "USAspending Top Tier Agencies",
  request: {
    url: "https://api.usaspending.gov/api/v2/references/toptier_agencies/",
    method: "GET",
    headers: {},
  },
  response: {
    recordsPath: "results",
  },
} as const;

const features = [
  {
    icon: Zap,
    title: "Shared flow",
    description: "Both entry points land in the same sandbox exploration pipeline",
  },
  {
    icon: Shield,
    title: "Real sandbox",
    description: "Python runs inside a live E2B workspace, fully isolated",
  },
  {
    icon: MessageSquare,
    title: "Copilot-ready",
    description: "Ask follow-ups without leaving the session",
  },
];

const stagger = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 },
    },
  },
  item: {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 280, damping: 28 } },
  },
};

export function UploadShell() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeSourceLabel, setActiveSourceLabel] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDrop(file: File | null | undefined) {
    if (!file || isUploading) return;

    setFileName(file.name);
    setActiveSourceLabel(null);
    setIsDragging(false);
    setIsUploading(true);
    setError(null);

    try {
      const sandboxResponse = await fetch("/api/sandbox", { method: "POST" });
      if (!sandboxResponse.ok) throw new Error("Failed to create a sandbox session.");
      const { sessionId } = (await sandboxResponse.json()) as { sessionId: string };

      const formData = new FormData();
      formData.set("sessionId", sessionId);
      formData.set("file", file);

      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const payload = (await uploadResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Upload failed.");
      }

      router.push(`/dashboard/${sessionId}`);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Something went wrong while creating the analytics workspace.",
      );
      setIsUploading(false);
    }
  }

  async function handleDemoLaunch() {
    if (isUploading) return;

    setFileName(null);
    setActiveSourceLabel(demoSource.label);
    setIsDragging(false);
    setIsUploading(true);
    setError(null);

    try {
      const sandboxResponse = await fetch("/api/sandbox", { method: "POST" });
      if (!sandboxResponse.ok) throw new Error("Failed to create a sandbox session.");
      const { sessionId } = (await sandboxResponse.json()) as { sessionId: string };

      const sourceResponse = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, source: demoSource }),
      });

      if (!sourceResponse.ok) {
        const payload = (await sourceResponse.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "Demo source failed.");
      }

      router.push(`/dashboard/${sessionId}`);
    } catch (sourceError) {
      setError(
        sourceError instanceof Error
          ? sourceError.message
          : "Something went wrong while creating the demo workspace.",
      );
      setIsUploading(false);
    }
  }

  const isDemoLoading = isUploading && activeSourceLabel === demoSource.label;

  return (
    <main className="noise-overlay relative min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      {/* Animated gradient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* Top spotlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#6366f1] to-transparent opacity-50" />
        <div className="absolute left-1/2 -top-32 h-64 w-[60%] -translate-x-1/2 rounded-full bg-[#6366f1] opacity-[0.09] blur-[80px]" />
        {/* Blobs */}
        <div className="animate-blob absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full bg-[#6366f1] opacity-[0.12] blur-[100px]" />
        <div className="animate-blob-delay absolute -right-40 top-20 h-[500px] w-[500px] rounded-full bg-[#8b5cf6] opacity-[0.09] blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-[#0ea5e9] opacity-[0.06] blur-[100px]" />
        {/* Dot grid */}
        <div className="dot-grid absolute inset-0" />
      </div>

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ scale: 1.08, rotate: 5 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="glow-accent flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              <Sparkles className="h-5 w-5" />
            </motion.div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)]">
                Viewpilot
              </p>
              <h1 className="text-base font-semibold text-[var(--foreground)]">
                CSV or API to analytics workspace
              </h1>
            </div>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="hidden sm:block"
          >
            <Badge
              variant="outline"
              className="items-center gap-2 rounded-full border-[var(--border-strong)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text-secondary)] backdrop-blur"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--success)]" />
              E2B sandbox ready
            </Badge>
          </motion.div>
        </motion.header>

        {/* Main grid */}
        <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
          {/* Hero card */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
            className="glass-card flex flex-col gap-7 rounded-[28px] p-7 sm:p-10"
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.35 }}
            >
              <Badge
                variant="outline"
                className="w-fit gap-2 rounded-full border-[var(--border)] bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]"
              >
                <WandSparkles className="h-3.5 w-3.5" />
                Start from a file or live sandbox-loaded demo
              </Badge>
            </motion.div>

            <motion.div
              variants={stagger.container}
              initial="hidden"
              animate="show"
              className="space-y-4"
            >
              <motion.h2
                variants={stagger.item}
                className="text-[clamp(2rem,8vw,3.25rem)] font-semibold leading-[1.15] tracking-tight text-[var(--foreground)] sm:text-5xl"
              >
                Turn a CSV or public API into a{" "}
                <span className="bg-gradient-to-r from-[#6366f1] to-[#a78bfa] bg-clip-text text-transparent">
                  live analytics dashboard.
                </span>
              </motion.h2>
              <motion.p
                variants={stagger.item}
                className="max-w-2xl text-base leading-7 text-[var(--text-secondary)] sm:text-lg"
              >
                We create an E2B sandbox, ingest the source, profile your dataset in Python,
                and open a dashboard with KPIs, charts, insights, and a copilot rail for
                follow-up questions.
              </motion.p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.35 }}
              className="flex flex-col gap-3 sm:flex-row sm:flex-wrap"
            >
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUploading}
                  size="lg"
                  className="rounded-full bg-[var(--accent)] px-6 text-sm font-medium text-white shadow-lg shadow-[var(--accent-glow)] hover:bg-indigo-500 hover:shadow-[0_0_32px_var(--accent-glow)]"
                >
                  {isUploading && !isDemoLoading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CloudUpload className="h-4 w-4" />
                  )}
                  {isUploading && !isDemoLoading ? "Building workspace..." : "Choose CSV"}
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  type="button"
                  onClick={() => void handleDemoLaunch()}
                  disabled={isUploading}
                  variant="outline"
                  size="lg"
                  className="rounded-full border-[var(--border-strong)] bg-[var(--card)] px-6 text-sm text-[var(--foreground)] backdrop-blur hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                >
                  {isDemoLoading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-[var(--accent)]" />
                  ) : (
                    <Database className="h-4 w-4 text-[var(--accent)]" />
                  )}
                  Use USAspending demo
                </Button>
              </motion.div>
            </motion.div>

            {/* Feature pills */}
            <motion.div
              variants={stagger.container}
              initial="hidden"
              animate="show"
              className="grid gap-3 sm:grid-cols-3"
            >
              {features.map(({ icon: Icon, title, description }) => (
                <motion.div
                  key={title}
                  variants={stagger.item}
                  whileHover={{ y: -2, transition: { type: "spring", stiffness: 400 } }}
                  className="glass-panel rounded-2xl p-4"
                >
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          {/* Upload panel */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
            className="glass-panel flex flex-col rounded-[28px] p-5 sm:p-6"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(event) => void handleDrop(event.target.files?.[0])}
            />

            {/* Drop zone */}
            <motion.div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                void handleDrop(event.dataTransfer.files?.[0]);
              }}
              animate={isDragging ? { scale: 1.01 } : { scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={cn(
                "group flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-[20px] border border-dashed p-8 text-center transition-colors duration-200",
                isDragging
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--surface)]",
              )}
            >
              <motion.div
                animate={isDragging ? { scale: 1.15, rotate: 8 } : isUploading ? { rotate: 0 } : { scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={cn(
                  "flex h-16 w-16 items-center justify-center rounded-2xl transition-colors duration-200",
                  isDragging
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--accent-soft)] text-[var(--accent)]",
                )}
              >
                {isUploading ? (
                  <LoaderCircle className="h-7 w-7 animate-spin" />
                ) : isDragging ? (
                  <CloudUpload className="h-7 w-7" />
                ) : (
                  <BarChart3 className="h-7 w-7" />
                )}
              </motion.div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={fileName ?? activeSourceLabel ?? "default"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-1"
                >
                  <p className="text-base font-semibold text-[var(--foreground)]">
                    {fileName ?? activeSourceLabel ?? (isDragging ? "Drop it!" : "Drop a CSV here")}
                  </p>
                  <p className="max-w-[240px] text-sm leading-6 text-[var(--text-secondary)]">
                    {isUploading
                      ? isDemoLoading
                        ? "Fetching the API in E2B and generating your dashboard."
                        : "Uploading and generating your first dashboard."
                      : "Or click Choose CSV above to browse your files."}
                  </p>
                </motion.div>
              </AnimatePresence>
            </motion.div>

            {/* Divider */}
            <div className="my-4 flex items-center gap-3">
              <div className="flex-1 border-t border-[var(--border)]" />
              <span className="text-xs text-[var(--text-muted)]">or use a preset</span>
              <div className="flex-1 border-t border-[var(--border)]" />
            </div>

            {/* Demo preset */}
            <motion.div
              whileHover={{ y: -1 }}
              transition={{ type: "spring", stiffness: 400 }}
              className="glass-card rounded-2xl p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <FileText className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    USAspending Demo
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                    Top-tier agency totals from the public API
                  </p>
                </div>
                <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDemoLaunch()}
                    disabled={isUploading}
                    className="shrink-0 rounded-full border-[var(--border-strong)] bg-[var(--card)] text-xs text-[var(--foreground)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                  >
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--accent)]" />
                    Launch
                  </Button>
                </motion.div>
              </div>
            </motion.div>

            {/* Status row */}
            <div className="mt-4 space-y-2 rounded-2xl border border-[var(--border)] p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Selected source</span>
                <span className="max-w-[180px] truncate text-right font-medium text-[var(--foreground)]">
                  {fileName ?? activeSourceLabel ?? "None"}
                </span>
              </div>
              <div className="border-t border-[var(--border)]" />
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Max file size</span>
                <span className="text-[var(--text-secondary)]">50 MB</span>
              </div>
              <div className="border-t border-[var(--border)]" />
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Pipeline</span>
                <span className="text-[var(--text-secondary)]">Source → Sandbox → Dashboard</span>
              </div>
              <AnimatePresence>
                {error ? (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="pt-1 text-xs text-[var(--danger)]"
                  >
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </main>
  );
}
