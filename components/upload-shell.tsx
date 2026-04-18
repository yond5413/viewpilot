"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CloudUpload,
  FileText,
  LoaderCircle,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "./cn";

export function UploadShell() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDrop(file: File | null | undefined) {
    if (!file || isUploading) return;

    setFileName(file.name);
    setIsDragging(false);
    setIsUploading(true);
    setError(null);

    try {
      const sandboxResponse = await fetch("/api/sandbox", {
        method: "POST",
      });

      if (!sandboxResponse.ok) {
        throw new Error("Failed to create a sandbox session.");
      }

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

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent)]/12 text-[var(--accent)] shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--text-secondary)]">
                Viewpilot
              </p>
              <h1 className="text-lg font-semibold text-[var(--foreground)]">
                CSV to analytics workspace
              </h1>
            </div>
          </div>
          <Badge variant="outline" className="hidden items-center gap-2 rounded-full px-3 py-2 text-xs shadow-sm sm:inline-flex">
            <span className="h-2 w-2 rounded-full bg-[var(--success)]" />
            E2B-backed exploration ready
          </Badge>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <Card className="shell-card panel-enter rounded-[28px] border-[var(--border)] bg-white/85 shadow-none">
            <CardHeader className="space-y-5 p-6 sm:p-8">
              <Badge variant="outline" className="w-fit gap-2 rounded-full px-3 py-1 text-xs">
                <WandSparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                Upload once, then iterate with the copilot
              </Badge>
              <div className="space-y-3">
                <CardTitle className="text-4xl font-semibold tracking-tight text-[var(--foreground)] sm:text-5xl">
                  Turn a raw CSV into a live analytics dashboard.
                </CardTitle>
                <CardDescription className="max-w-2xl text-base leading-7 text-[var(--text-secondary)] sm:text-lg">
                  We create an E2B sandbox, upload the file, profile the dataset in Python, and open a dashboard with
                  KPIs, charts, insights, and a copilot rail ready for follow-up questions.
                </CardDescription>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={isUploading}
                  size="lg"
                  className="rounded-full text-sm"
                >
                  {isUploading ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CloudUpload className="h-4 w-4" />
                  )}
                  {isUploading ? "Building workspace..." : "Choose CSV"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="rounded-full text-sm"
                >
                  <ArrowRight className="h-4 w-4 text-[var(--accent)]" />
                  Dashboard appears right after upload
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Agentic flow", "Upload, profile, and assemble the first dashboard"],
                  ["Real sandbox", "Python runs inside a live E2B workspace"],
                  ["Copilot-ready", "Ask follow-ups without leaving the session"],
                ].map(([title, copy]) => (
                  <Card key={title} className="border-[var(--border)] bg-white/80 shadow-none">
                    <CardContent className="p-4">
                      <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{copy}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardHeader>
          </Card>

          <Card className="shell-panel panel-enter rounded-[28px] border-[var(--border)] bg-white shadow-none">
            <CardContent className="p-5 sm:p-6">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(event.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "group flex min-h-[420px] flex-col justify-between rounded-[24px] border border-dashed p-5 transition",
                  isDragging
                    ? "border-[var(--accent)] bg-[rgba(238,242,255,0.72)]"
                    : "border-[var(--border)] bg-gradient-to-b from-white to-[var(--surface-soft)]",
                )}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(event) => void handleDrop(event.target.files?.[0])}
                />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                      <FileText className="h-4 w-4 text-[var(--accent)]" />
                      CSV dropzone
                    </div>
                    <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
                      50MB max
                    </Badge>
                  </div>

                  <Card className="rounded-[22px] border-[var(--border)] bg-white p-0 shadow-none">
                    <CardContent className="p-5">
                      <div className="shell-grid rounded-[18px] p-6">
                        <div className="flex min-h-48 flex-col items-center justify-center rounded-[18px] border border-dashed border-[var(--border)] bg-white/90 p-6 text-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                            {isUploading ? (
                              <LoaderCircle className="h-6 w-6 animate-spin" />
                            ) : (
                              <BarChart3 className="h-6 w-6" />
                            )}
                          </div>
                          <p className="mt-4 text-lg font-semibold text-[var(--foreground)]">
                            {fileName ?? "Drop a CSV here"}
                          </p>
                          <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--text-secondary)]">
                            {isUploading
                              ? "Creating the sandbox, uploading the file, and generating the first dashboard."
                              : "We'll open a live dashboard as soon as the dataset is profiled."}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="mt-6 border-[var(--border)] bg-white/80 shadow-none">
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-[var(--foreground)]">Selected file</span>
                      <span className="text-[var(--text-secondary)]">{fileName ?? "No file chosen"}</span>
                    </div>
                    <Separator className="bg-[var(--border)]" />
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-[var(--foreground)]">Pipeline</span>
                      <span className="text-[var(--text-secondary)]">Upload → Explore → Dashboard</span>
                    </div>
                    {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
