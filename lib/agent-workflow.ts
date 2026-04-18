import { createHash } from "node:crypto";
import {
  createQueryTrace,
  appendQueryTraceEvent,
  finalizeQueryTrace,
  summarizeQueryTrace,
} from "@/lib/query-trace-store";
import {
  composeAssistantMessage,
  createTaskSpec as create_task_spec,
  criticResult as critic_result,
  generateAnalysisCode as generate_analysis_code,
  generateSuggestedPrompts,
  repairAnalysisCode,
  routeAnalysisRequest,
} from "@/lib/analytics";
import {
  connectSandbox,
  loadSessionAnalysisStateFromSandbox,
  runPythonAnalysis,
  writeSessionAnalysisStateToSandbox,
} from "@/lib/e2b";
import {
  appendQueryStreamEvent,
  completeQueryStream,
  startQueryStream,
} from "@/lib/server/query-stream-store";
import type {
  AnalysisCandidate,
  AnalysisMemory,
  AnalysisRoute,
  CriticDecision,
  DashboardMutation,
  DashboardPanel,
  DashboardState,
  ExecutionEnvelope,
  ExecutionPath,
  FallbackDecision,
  KPI,
  PanelProvenance,
  QueryStage,
  SessionAnalysisState,
  StageErrorCode,
  TaskHistoryEntry,
  TaskSpec,
  ValidationResult,
} from "@/lib/types";
import { makeId, nowIso } from "@/lib/utils";

const EMPTY_CELL = "—";
const RESULT_PREFIX = "VIEWPILOT_RESULT:";

type StageSummary = {
  summary: string;
  rawPreview?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type WorkflowStageErrorArgs = {
  stage: QueryStage;
  code: StageErrorCode;
  traceId: string;
  message: string;
  rawPreview?: string;
};

export class WorkflowStageError extends Error {
  readonly stage: QueryStage;
  readonly code: StageErrorCode;
  readonly traceId: string;
  readonly rawPreview?: string;

  constructor(args: WorkflowStageErrorArgs) {
    super(args.message);
    this.name = "WorkflowStageError";
    this.stage = args.stage;
    this.code = args.code;
    this.traceId = args.traceId;
    this.rawPreview = args.rawPreview;
  }
}

const previewRaw = (value: unknown, maxLength = 280) => {
  if (value == null) {
    return undefined;
  }

  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text || undefined;
};

export const formatQueryStageLabel = (stage: QueryStage) =>
  stage.replace(/_/g, " ");

const defaultStageErrorCode = (stage: QueryStage): StageErrorCode => {
  switch (stage) {
    case "session_context":
      return "SESSION_STATE_INVALID";
    case "route":
      return "ROUTE_JSON_INVALID";
    case "task_spec":
      return "TASK_SPEC_JSON_INVALID";
    case "codegen":
      return "CODEGEN_JSON_INVALID";
    case "sandbox_execution":
      return "SANDBOX_EXECUTION_FAILED";
    case "sandbox_result_parse":
      return "SANDBOX_RESULT_INVALID_JSON";
    case "validation":
      return "VALIDATION_REJECTED";
    case "critic":
      return "CRITIC_REJECTED";
    case "persist":
      return "PERSIST_FAILED";
    default:
      return "REQUEST_INVALID";
  }
};

const asStageError = (
  error: unknown,
  traceId: string,
  stage: QueryStage,
  fallbackCode?: StageErrorCode,
) => {
  if (error instanceof WorkflowStageError) {
    return error;
  }

  return new WorkflowStageError({
    stage,
    code: fallbackCode ?? defaultStageErrorCode(stage),
    traceId,
    message: error instanceof Error ? error.message : `Unknown ${formatQueryStageLabel(stage)} failure.`,
    rawPreview: error instanceof Error ? previewRaw(error.message) : previewRaw(error),
  });
};

const runStage = async <T>(args: {
  sessionId?: string;
  traceId: string;
  stage: QueryStage;
  fn: () => Promise<T>;
  summarize?: (data: T) => StageSummary;
  fallbackCode?: StageErrorCode;
}) => {
  const startedAt = Date.now();
  if (args.sessionId) {
    appendQueryStreamEvent(args.sessionId, {
      traceId: args.traceId,
      type: "stage_started",
      stage: args.stage,
      message: `Starting ${formatQueryStageLabel(args.stage)}.`,
    });
  }
  try {
    const data = await args.fn();
    const summary = args.summarize?.(data) ?? {
      summary: `${formatQueryStageLabel(args.stage)} completed.`,
    };
    appendQueryTraceEvent(args.traceId, {
      stage: args.stage,
      ok: true,
      summary: summary.summary,
      rawPreview: summary.rawPreview,
      metadata: summary.metadata,
      durationMs: Date.now() - startedAt,
    });
    if (args.sessionId) {
      appendQueryStreamEvent(args.sessionId, {
        traceId: args.traceId,
        type: "stage_progress",
        stage: args.stage,
        message: summary.summary,
        payload: summary.metadata,
      });
    }
    return data;
  } catch (error) {
    const stageError = asStageError(error, args.traceId, args.stage, args.fallbackCode);
    appendQueryTraceEvent(args.traceId, {
      stage: args.stage,
      ok: false,
      summary: stageError.message,
      rawPreview: stageError.rawPreview,
      durationMs: Date.now() - startedAt,
      metadata: { code: stageError.code },
    });
    if (args.sessionId) {
      appendQueryStreamEvent(args.sessionId, {
        traceId: args.traceId,
        type: "stage_failed",
        stage: args.stage,
        message: stageError.message,
        payload: { code: stageError.code },
      });
    }
    throw stageError;
  }
};

const compactNumber = (value: number, options?: { style?: "currency" | "percent" }) => {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (options?.style === "percent") {
    return `${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: Math.abs(value) < 1 ? 2 : 1,
    }).format(value)}%`;
  }

  const absolute = Math.abs(value);
  const formatter = new Intl.NumberFormat("en-US", {
    notation: absolute >= 1000 ? "compact" : "standard",
    maximumFractionDigits: absolute >= 1000 ? 2 : absolute >= 1 ? 1 : 3,
  });

  return options?.style === "currency"
    ? `$${formatter.format(value)}`
    : formatter.format(value);
};

const normalizeDisplayValue = (value: unknown) => {
  if (value == null) {
    return EMPTY_CELL;
  }

  if (typeof value === "number") {
    return compactNumber(value) ?? EMPTY_CELL;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  const text = String(value).trim();
  if (!text) {
    return EMPTY_CELL;
  }

  const currencyMatch = text.match(/^\$?\s*(-?\d[\d,]*(?:\.\d+)?)$/);
  if (currencyMatch) {
    const numeric = Number(currencyMatch[1].replace(/,/g, ""));
    const compact = compactNumber(numeric, { style: text.includes("$") ? "currency" : undefined });
    if (compact) {
      return compact;
    }
  }

  const percentMatch = text.match(/^(-?\d[\d,]*(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const numeric = Number(percentMatch[1].replace(/,/g, ""));
    const compact = compactNumber(numeric, { style: "percent" });
    if (compact) {
      return compact;
    }
  }

  return text.length > 48 ? `${text.slice(0, 45).trimEnd()}…` : text;
};

const normalizeLabel = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const compact = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[_-]+/g, " ");

  return compact || fallback;
};

const makeFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const addProvenance = (
  provenance: PanelProvenance,
  kpis: KPI[],
  panels: DashboardPanel[],
) => ({
  kpis: kpis.map((kpi) => ({
    ...kpi,
    provenance: { ...provenance, ...kpi.provenance },
  })),
  panels: panels.map((panel) => ({
    ...panel,
    provenance: { ...provenance, ...panel.provenance },
  })),
});

const normalizeKpi = (kpi: unknown, provenance: PanelProvenance): KPI | null => {
  if (!kpi || typeof kpi !== "object") {
    return null;
  }

  const candidate = kpi as Record<string, unknown>;
  if (typeof candidate.label !== "string" || candidate.value == null) {
    return null;
  }

  const value = normalizeDisplayValue(candidate.value);
  if (value.length > 18) {
    return null;
  }

  const tone =
    candidate.tone === "positive" ||
    candidate.tone === "warning" ||
    candidate.tone === "neutral"
      ? candidate.tone
      : "neutral";

  return {
    id: makeId("kpi"),
    label: normalizeLabel(candidate.label, "Metric").slice(0, 28),
    value,
    delta:
      typeof candidate.delta === "string" ? normalizeDisplayValue(candidate.delta) : undefined,
    tone,
    provenance,
  };
};

const normalizeTableRows = (columns: string[], rows: unknown[]) =>
  rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) =>
      columns.reduce<Record<string, string>>((accumulator, column) => {
        accumulator[column] = normalizeDisplayValue(row[column]);
        return accumulator;
      }, {}),
    )
    .filter((row) => Object.values(row).some((value) => value !== EMPTY_CELL))
    .slice(0, 5);

const hasUsefulSeriesValues = (value: unknown, minimum = 2) =>
  Array.isArray(value) && value.filter((item) => normalizeDisplayValue(item) !== EMPTY_CELL).length >= minimum;

const hasStrongPlotlySignal = (data: Record<string, unknown>[]) =>
  data.some((trace) => {
    const type = typeof trace.type === "string" ? trace.type.toLowerCase() : "";

    if (type === "pie") {
      return hasUsefulSeriesValues(trace.labels, 2) && hasUsefulSeriesValues(trace.values, 2);
    }

    if (type === "histogram") {
      return hasUsefulSeriesValues(trace.x, 8) || hasUsefulSeriesValues(trace.y, 8);
    }

    if (type === "box") {
      return hasUsefulSeriesValues(trace.y, 5) || hasUsefulSeriesValues(trace.x, 5);
    }

    return hasUsefulSeriesValues(trace.x, 2) && hasUsefulSeriesValues(trace.y, 2);
  });

const hasLowSignalTable = (columns: string[], rows: Array<Record<string, string>>) => {
  if (columns.length === 0 || rows.length === 0) {
    return true;
  }

  const values = rows.flatMap((row) => columns.map((column) => row[column] ?? EMPTY_CELL));
  const emptyRatio = values.filter((value) => value === EMPTY_CELL).length / values.length;
  if (emptyRatio > 0.4) {
    return true;
  }

  const distinctRows = new Set(rows.map((row) => columns.map((column) => row[column]).join("|")));
  return distinctRows.size < 2;
};

const normalizePanel = (
  panel: unknown,
  provenance: PanelProvenance,
): DashboardPanel | null => {
  if (!panel || typeof panel !== "object") {
    return null;
  }

  const candidate = panel as Record<string, unknown>;
  if (
    candidate.kind === "plotly" &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string" &&
    candidate.spec &&
    typeof candidate.spec === "object"
  ) {
    const spec = candidate.spec as Record<string, unknown>;
    const data = Array.isArray(spec.data)
      ? spec.data.filter((trace): trace is Record<string, unknown> => Boolean(trace) && typeof trace === "object")
      : [];

    if (data.length === 0) {
      return null;
    }

    if (!hasStrongPlotlySignal(data)) {
      return null;
    }

    return {
      id: makeId("panel"),
      kind: "plotly",
      title: normalizeLabel(candidate.title, "Chart"),
      description: normalizeLabel(candidate.description, "Generated chart"),
      insight: typeof candidate.insight === "string" ? candidate.insight : undefined,
      provenance,
      spec: {
        data,
        layout: typeof spec.layout === "object" && spec.layout ? (spec.layout as Record<string, unknown>) : undefined,
        config: typeof spec.config === "object" && spec.config ? (spec.config as Record<string, unknown>) : undefined,
      },
    };
  }

  if (
    candidate.kind === "table" &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string" &&
    Array.isArray(candidate.columns) &&
    Array.isArray(candidate.rows)
  ) {
    const columns = candidate.columns
      .filter((column): column is string => typeof column === "string")
      .map((column) => normalizeLabel(column, "Column"))
      .slice(0, 6);

    const rows = normalizeTableRows(columns, candidate.rows);
    if (columns.length === 0 || rows.length === 0 || hasLowSignalTable(columns, rows)) {
      return null;
    }

    return {
      id: makeId("panel"),
      kind: "table",
      title: normalizeLabel(candidate.title, "Summary table"),
      description: normalizeLabel(candidate.description, "Generated table"),
      insight: typeof candidate.insight === "string" ? candidate.insight : undefined,
      provenance,
      columns,
      rows,
    };
  }

  if (
    candidate.kind === "html" &&
    typeof candidate.title === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.html === "string"
  ) {
    return {
      id: makeId("panel"),
      kind: "html",
      title: normalizeLabel(candidate.title, "Generated insight"),
      description: normalizeLabel(candidate.description, "Generated analysis"),
      insight: typeof candidate.insight === "string" ? candidate.insight : undefined,
      provenance,
      html: candidate.html,
    };
  }

  return null;
};

const summarizeContext = (session: DashboardState, analysisState: SessionAnalysisState) =>
  JSON.stringify({
    datasetFingerprint: analysisState.datasetFingerprint,
    filename: session.filename,
    primaryDimensions: analysisState.analysisMemory?.primaryDimensions.slice(0, 4),
    primaryMeasures: analysisState.analysisMemory?.primaryMeasures.slice(0, 4),
    dateCandidates: analysisState.analysisMemory?.dateCandidates.slice(0, 2),
    opportunities: analysisState.analysisMemory?.opportunities.slice(0, 4).map((item) => ({
      kind: item.kind,
      title: item.title,
      chartFamily: item.chartFamily,
      dimension: item.dimension,
      measure: item.measure,
    })),
    validatedMetricLabels: analysisState.validatedMetrics.map((item) => item.label).slice(0, 6),
    validatedPanelTitles: analysisState.validatedPanels.map((item) => item.title).slice(0, 8),
    cachedKeys: Object.keys(analysisState.cachedResults).slice(0, 10),
    failedPatterns: analysisState.failedPatterns.slice(-5),
    recentPrompts: session.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .slice(-4),
  });

const escapeJsonString = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const parseCandidateEnvelope = (raw: string) => {
  const candidate = raw.trim();

  try {
    return JSON.parse(candidate) as AnalysisCandidate;
  } catch {
    const normalized = candidate
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/([\{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_match, prefix, key) => {
        return `${prefix}"${escapeJsonString(key)}":`;
      })
      .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*[,}\]])/g, (_match, value) => {
        return `: "${escapeJsonString(value)}"`;
      })
      .replace(/([\[,])\s*'([^'\\]*(?:\\.[^'\\]*)*)'(?=\s*[,\]])/g, (_match, prefix, value) => {
        return `${prefix} "${escapeJsonString(value)}"`;
      });

    return JSON.parse(normalized) as AnalysisCandidate;
  }
};

const parseExecutionResult = (args: {
  resultRaw?: string;
  stdout: string;
}): { candidate: AnalysisCandidate; source: ExecutionEnvelope["resultSource"] } => {
  if (args.resultRaw?.trim()) {
    return {
      candidate: parseCandidateEnvelope(args.resultRaw),
      source: "file",
    };
  }

  const resultLine = args.stdout
    .split("\n")
    .find((line) => line.startsWith(RESULT_PREFIX));

  if (!resultLine) {
    throw new Error("Sandbox did not produce a machine-readable result file or stdout envelope.");
  }

  return {
    candidate: parseCandidateEnvelope(resultLine.replace(RESULT_PREFIX, "")),
    source: "stdout",
  };
};

const dedupePanels = (panels: DashboardPanel[]) => {
  const seen = new Set<string>();
  return panels.filter((panel) => {
    const key = `${panel.kind}:${panel.title.toLowerCase()}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const extractArtifactPaths = (artifacts: AnalysisCandidate["artifacts"]) => {
  if (Array.isArray(artifacts)) {
    return artifacts.filter((item): item is string => typeof item === "string");
  }

  if (artifacts && typeof artifacts === "object") {
    return Object.keys(artifacts);
  }

  return [];
};

const validate_result = (args: {
  route: AnalysisRoute;
  taskSpec: TaskSpec;
  candidate: AnalysisCandidate;
  session: DashboardState;
  sourceTaskId: string;
  model: string;
  artifactPaths: string[];
}): ValidationResult => {
  const reasons: string[] = [];
  const provenance: PanelProvenance = {
    sourceTaskId: args.sourceTaskId,
    cacheKey: args.taskSpec.cacheKey,
    generatedByModel: args.model,
    validatedAt: nowIso(),
    routeClass: args.route.requestClass,
    artifactPaths: args.artifactPaths,
  };

  const kpis = Array.isArray(args.candidate.kpis)
    ? args.candidate.kpis
        .map((item) => normalizeKpi(item, provenance))
        .filter((item): item is KPI => Boolean(item))
        .slice(0, args.taskSpec.displayConstraints.maxKpis)
    : [];

  const panels = Array.isArray(args.candidate.panels)
    ? dedupePanels(
        args.candidate.panels
          .map((item) => normalizePanel(item, provenance))
          .filter((item): item is DashboardPanel => Boolean(item))
          .slice(0, args.taskSpec.displayConstraints.maxPanels),
      )
    : [];

  const insights = Array.isArray(args.candidate.insights)
    ? Array.from(
        new Set(
          args.candidate.insights
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).slice(0, 5)
    : [];

  if (args.taskSpec.expectedOutputs.kpis && kpis.length === 0) {
    reasons.push("Expected KPI output but none passed validation.");
  }

  if (args.taskSpec.expectedOutputs.panels && panels.length === 0) {
    reasons.push("Expected at least one panel but none passed validation.");
  }

  if (
    args.route.requestClass === "dashboard_refresh" &&
    panels.length < Math.max(1, Math.min(2, args.taskSpec.composition.targetPanels))
  ) {
    reasons.push("Dashboard refresh needs at least one strong visual update.");
  }

  if (
    args.taskSpec.expectedOutputs.kpis &&
    kpis.length < Math.max(1, Math.min(2, args.taskSpec.composition.targetKpis))
  ) {
    reasons.push("The KPI package is too thin for a composed dashboard update.");
  }

  if (panels.some((panel) => panel.title.length > 64)) {
    reasons.push("Panel titles must remain concise.");
  }

  if (kpis.some((kpi) => kpi.value.length > args.taskSpec.displayConstraints.maxValueLength)) {
    reasons.push("One or more KPI values are too long for the card layout.");
  }

  const duplicateWithExisting = panels.some((panel) =>
    args.session.panels.some(
      (existing) =>
        existing.kind === panel.kind &&
        existing.title.trim().toLowerCase() === panel.title.trim().toLowerCase(),
    ),
  );

  if (duplicateWithExisting && args.route.requestClass === "panel_add") {
    reasons.push("Generated panel duplicates an existing validated panel.");
  }

  return {
    status: reasons.length === 0 ? "approved" : "rejected",
    reasons,
    kpis,
    panels,
    insights,
    narrative: typeof args.candidate.narrative === "string" ? args.candidate.narrative.trim() : undefined,
    confidence: reasons.length === 0 ? Math.max(0.68, args.route.confidence) : 0.3,
  };
};

const safeCacheCandidate = (value: unknown): AnalysisCandidate | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as AnalysisCandidate;
};

const load_cached_result = (
  analysisState: SessionAnalysisState,
  cacheKey: string,
) => safeCacheCandidate(analysisState.cachedResults[cacheKey]);

const applyMutation = (
  session: DashboardState,
  mutation: DashboardMutation,
) => {
  switch (mutation.mutationType) {
    case "dashboard_refresh":
      return {
        kpis: mutation.kpis.length > 0 ? mutation.kpis : session.kpis,
        panels:
          mutation.panels.length > 0
            ? dedupePanels([...mutation.panels, ...session.panels]).slice(
                0,
                Math.max(mutation.panels.length, 2),
              )
            : session.panels,
        insights: mutation.insights.length > 0 ? mutation.insights : session.insights,
      };
    case "kpi_update":
      return {
        kpis: mutation.kpis.length > 0 ? mutation.kpis : session.kpis,
        panels: session.panels,
        insights: mutation.insights.length > 0 ? mutation.insights : session.insights,
      };
    case "panel_replace": {
      const remaining = session.panels.slice(1);
      return {
        kpis: session.kpis,
        panels:
          mutation.panels.length > 0
            ? dedupePanels([...mutation.panels, ...remaining]).slice(0, 8)
            : session.panels,
        insights: mutation.insights.length > 0 ? mutation.insights : session.insights,
      };
    }
    case "panel_add":
      return {
        kpis: session.kpis,
        panels:
          mutation.panels.length > 0
            ? dedupePanels([...mutation.panels, ...session.panels]).slice(0, 8)
            : session.panels,
        insights: mutation.insights.length > 0 ? mutation.insights : session.insights,
      };
    default:
      return {
        kpis: session.kpis,
        panels: session.panels,
        insights: mutation.insights.length > 0 ? mutation.insights : session.insights,
      };
  }
};

const compose_dashboard_mutation = async (args: {
  session: DashboardState;
  route: AnalysisRoute;
  taskSpec: TaskSpec;
  validationResult: ValidationResult;
  criticDecision: CriticDecision;
  fallbackDecision?: FallbackDecision;
  cachedCandidate?: AnalysisCandidate | null;
}) => {
  const preservedExisting =
    args.criticDecision.status === "downgrade" ||
    args.criticDecision.status === "reject" ||
    args.route.requestClass === "answer" ||
    args.route.requestClass === "diagnostic";

  let mutation: DashboardMutation;

  if (args.criticDecision.status === "reject") {
    mutation = {
      mutationType: "none",
      assistantMessage: "The dashboard was preserved because the generated result did not pass quality checks.",
      narrative:
        args.cachedCandidate?.narrative ||
        args.validationResult.narrative ||
        "I kept the current dashboard intact and avoided applying a weak mutation.",
      kpis: args.session.kpis,
      panels: args.session.panels,
      insights: args.session.insights,
      preservedExisting: true,
    };
  } else if (args.criticDecision.status === "downgrade") {
    mutation = {
      mutationType: "none",
      assistantMessage: "I answered conservatively and preserved the existing dashboard.",
      narrative:
        args.cachedCandidate?.narrative ||
        args.validationResult.narrative ||
        "I preserved the current dashboard and responded narratively because the requested update was not strong enough to ship.",
      kpis: args.session.kpis,
      panels: args.session.panels,
      insights: args.session.insights,
      preservedExisting: true,
    };
  } else {
    const mutationType =
      args.route.requestClass === "dashboard_refresh"
        ? "dashboard_refresh"
        : args.route.requestClass === "kpi_update"
          ? "kpi_update"
          : args.route.requestClass === "panel_replace"
            ? "panel_replace"
            : args.route.requestClass === "panel_add"
              ? "panel_add"
              : "none";

    mutation = {
      mutationType,
      assistantMessage: "Applied a validated dashboard update.",
      narrative: args.validationResult.narrative,
      kpis: args.validationResult.kpis,
      panels: args.validationResult.panels,
      insights: args.validationResult.insights,
      preservedExisting,
    };
  }

  const summary = await composeAssistantMessage({
    prompt: args.taskSpec.userPrompt,
    route: args.route,
    taskSpec: args.taskSpec,
    mutationSummary: mutation.assistantMessage,
    insights: mutation.insights,
    kpiLabels: mutation.kpis.map((item) => item.label),
    panelTitles: mutation.panels.map((item) => item.title),
    narrative: mutation.narrative,
  });

  return {
    ...mutation,
    assistantMessage: summary,
  } satisfies DashboardMutation;
};

const updateObservability = (
  analysisState: SessionAnalysisState,
  update: Partial<SessionAnalysisState["observability"]>,
) => ({
  ...analysisState,
  observability: {
    ...analysisState.observability,
    ...Object.fromEntries(
      Object.entries(update).map(([key, value]) => [
        key,
        (analysisState.observability[key as keyof SessionAnalysisState["observability"]] ?? 0) +
          (value ?? 0),
      ]),
    ),
  },
});

const buildFallbackDecision = (strategy: FallbackDecision["strategy"], reason: string) => ({
  strategy,
  reason,
});

export const initializeAnalysisState = (args: {
  profile: DashboardState["profile"];
  analysisMemory?: AnalysisMemory;
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
}) => {
  const fingerprint = makeFingerprint({
    profile: args.profile,
  });
  const provenance: PanelProvenance = {
    sourceTaskId: "initial-profile",
    cacheKey: "initial_profile",
    generatedByModel: "deterministic-python",
    validatedAt: nowIso(),
    routeClass: "dashboard_refresh",
    mutationType: "dashboard_refresh",
  };
  const seeded = addProvenance(provenance, args.kpis, args.panels);

  return {
    datasetFingerprint: fingerprint,
    profile: args.profile ?? undefined,
    analysisMemory: args.analysisMemory,
    validatedMetrics: seeded.kpis,
    validatedPanels: seeded.panels,
    cachedResults: {
      initial_profile: {
        title: args.profile?.filename,
        kpis: seeded.kpis,
        panels: seeded.panels,
        insights: args.insights,
        narrative: `Initial dashboard seeded from ${args.profile?.filename ?? "the uploaded dataset"}.`,
      },
    },
    taskHistory: [],
    failedPatterns: [],
    artifacts: [],
    currentDashboardVersion: 1,
    observability: {
      requestCount: 0,
      cacheHitCount: 0,
      executionCount: 0,
      executionFailureCount: 0,
      validationRejectCount: 0,
      criticRejectCount: 0,
      fallbackCount: 0,
      panelReplacementCount: 0,
      totalRuntimeMs: 0,
    },
  } satisfies SessionAnalysisState;
};

export const load_session_context = async (session: DashboardState) => {
  const sandbox = await connectSandbox(session.sandboxId);
  const sandboxState = await loadSessionAnalysisStateFromSandbox(sandbox);
  const analysisState = sandboxState ?? session.analysisState;

  return {
    sandbox,
    analysisState,
    contextSummary: summarizeContext(session, analysisState),
  };
};

const execute_analysis_code = async (args: {
  sandboxId: string;
  code: string;
  model: string;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onResult?: (result: unknown) => void;
}) => {
  const sandbox = await connectSandbox(args.sandboxId);
  const execution = await runPythonAnalysis(sandbox, args.code, {
    onStdout: args.onStdout,
    onStderr: args.onStderr,
    onResult: args.onResult,
  });

  return {
    status: execution.error ? "error" : "success",
    code: args.code,
    model: args.model,
    stdout: execution.stdout,
    stderr: execution.stderr,
    errorMessage:
      execution.error?.value ||
      execution.error?.traceback,
    artifactPaths:
      [],
    runtimeMs: execution.runtimeMs,
    cacheCandidates: {},
    resultRaw: execution.resultFile ?? undefined,
    resultSource: execution.resultFile ? "file" : execution.stdout.includes(RESULT_PREFIX) ? "stdout" : "none",
  } satisfies ExecutionEnvelope;
};

const recordTask = (
  analysisState: SessionAnalysisState,
  task: TaskHistoryEntry,
) => ({
  ...analysisState,
  taskHistory: [...analysisState.taskHistory, task].slice(-25),
});

export const runInvestorWorkflow = async (args: {
  session: DashboardState;
  prompt: string;
}) => {
  const startedAt = Date.now();
  const trace = createQueryTrace(args.session.sessionId, args.prompt);
  startQueryStream(args.session.sessionId, trace.traceId);
  appendQueryStreamEvent(args.session.sessionId, {
    traceId: trace.traceId,
    type: "stage_progress",
    stage: "stream",
    message: "Copilot request received. Building an analysis plan.",
  });
  let lastStageError: WorkflowStageError | undefined;

  try {
    const { sandbox, analysisState: loadedState, contextSummary } = await runStage({
      traceId: trace.traceId,
      sessionId: args.session.sessionId,
      stage: "session_context",
      fn: () => load_session_context(args.session),
      summarize: (data) => ({
        summary: `Loaded session context for ${args.session.sessionId}.`,
        metadata: {
          hasSandboxState: Boolean(data.analysisState),
          sandboxId: args.session.sandboxId,
        },
      }),
    });
    let analysisState = updateObservability(loadedState, { requestCount: 1 });

    const route = await runStage({
      traceId: trace.traceId,
      sessionId: args.session.sessionId,
      stage: "route",
      fn: () =>
        routeAnalysisRequest({
          profile: args.session.profile!,
          analysisMemory: loadedState.analysisMemory,
          prompt: args.prompt,
          contextSummary,
        }),
      summarize: (data) => ({
        summary: `Routed request as ${data.requestClass}.`,
        metadata: {
          scope: data.scope,
          confidence: Number(data.confidence.toFixed(2)),
        },
      }),
    });

    const taskSpec = await runStage({
      traceId: trace.traceId,
      sessionId: args.session.sessionId,
      stage: "task_spec",
      fn: () =>
        create_task_spec({
          route,
          profile: args.session.profile!,
          analysisMemory: loadedState.analysisMemory,
          prompt: args.prompt,
          contextSummary,
        }),
      summarize: (data) => ({
        summary: `Planned ${data.kind} task with ${data.executionPath}.`,
        metadata: {
          responseType: data.responseType,
          cacheKey: data.cacheKey,
        },
      }),
    });

    const cachedCandidate = load_cached_result(analysisState, taskSpec.cacheKey);
    const executionPath: ExecutionPath =
      cachedCandidate && route.scope !== "full_rebuild" ? "use_cache" : taskSpec.executionPath;

    let executionEnvelope: ExecutionEnvelope | null = null;
    let validationResult: ValidationResult = {
      status: "approved",
      reasons: [],
      kpis: [],
      panels: [],
      insights: [],
      narrative: undefined,
      confidence: route.confidence,
    };
    let criticDecision: CriticDecision = {
      status: "downgrade",
      reasons: [],
      suggestedRestrictions: [],
    };
    let fallbackDecision: FallbackDecision | undefined;
    let usedModel = "none";
    let usedCode: string | undefined;

    const buildNarrativeFallback = (message: string, confidence: number) => ({
      status: "approved" as const,
      reasons: [],
      kpis: [],
      panels: [],
      insights: [],
      narrative: cachedCandidate?.narrative || message,
      confidence,
    });

    if (executionPath === "use_cache" && cachedCandidate) {
      analysisState = updateObservability(analysisState, { cacheHitCount: 1 });
      validationResult = await runStage({
          traceId: trace.traceId,
          sessionId: args.session.sessionId,
          stage: "validation",
        fn: async () =>
          validate_result({
            route,
            taskSpec: { ...taskSpec, executionPath },
            candidate: cachedCandidate,
            session: args.session,
            sourceTaskId: makeId("cache"),
            model: "cache",
            artifactPaths: [],
          }),
        summarize: (data) => ({
          summary: `Validated cached candidate with ${data.kpis.length} KPIs and ${data.panels.length} panels.`,
        }),
      });
    } else if (executionPath === "narrative_only") {
      fallbackDecision = buildFallbackDecision(
        "narrative_only",
        "This request is better served as a narrative explanation than a dashboard mutation.",
      );
      validationResult = buildNarrativeFallback(
        "I preserved the current dashboard and focused on a concise narrative answer for this request.",
        route.confidence,
      );
    } else {
      let generated: Awaited<ReturnType<typeof generate_analysis_code>> | null = null;

      try {
        generated = await runStage({
          traceId: trace.traceId,
          sessionId: args.session.sessionId,
          stage: "codegen",
          fn: () =>
            generate_analysis_code({
              profile: args.session.profile!,
              taskSpec,
              contextSummary,
              priorFailures: analysisState.failedPatterns,
            }),
          summarize: (data) => ({
            summary: data
              ? `Generated bounded Python program with ${data.expectedArtifacts.length} expected artifacts.`
              : "Codegen returned no bounded program.",
            metadata: {
              model: data?.model ?? "none",
            },
          }),
        });
      } catch (error) {
        lastStageError = asStageError(error, trace.traceId, "codegen");
      }

      if (!generated) {
        fallbackDecision = buildFallbackDecision(
          cachedCandidate ? "cached_answer" : "narrative_only",
          lastStageError?.message || "The code generation stage did not return a bounded analysis program.",
        );
        validationResult = buildNarrativeFallback(
          "I preserved the current dashboard because the analysis engine did not produce a reliable bounded program for this request.",
          0.5,
        );
      } else {
        usedModel = generated.model;
        usedCode = generated.code;
        analysisState = updateObservability(analysisState, { executionCount: 1 });
        executionEnvelope = await runStage({
          traceId: trace.traceId,
          sessionId: args.session.sessionId,
          stage: "sandbox_execution",
          fn: () =>
            execute_analysis_code({
              sandboxId: args.session.sandboxId,
              code: generated.code,
              model: generated.model,
              onStdout: (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                appendQueryStreamEvent(args.session.sessionId, {
                  traceId: trace.traceId,
                  type: "stage_progress",
                  stage: "sandbox_execution",
                  message: trimmed,
                });
              },
              onStderr: (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                appendQueryStreamEvent(args.session.sessionId, {
                  traceId: trace.traceId,
                  type: "stage_warning",
                  stage: "sandbox_execution",
                  message: trimmed,
                });
              },
              onResult: () => {
                appendQueryStreamEvent(args.session.sessionId, {
                  traceId: trace.traceId,
                  type: "stage_result",
                  stage: "sandbox_execution",
                  message: "Sandbox emitted an intermediate result artifact.",
                });
              },
            }),
          summarize: (data) => ({
            summary:
              data.status === "success"
                ? `Executed sandbox program in ${data.runtimeMs}ms.`
                : "Sandbox execution failed.",
            rawPreview: previewRaw(data.stderr || data.stdout),
            metadata: {
              resultSource: data.resultSource,
              runtimeMs: data.runtimeMs,
            },
          }),
        });

        if (
          executionEnvelope.status === "error" &&
          generated.code &&
          route.allowedFallbackDepth > 0
        ) {
          const repaired = await repairAnalysisCode({
            profile: args.session.profile!,
            taskSpec,
            contextSummary,
            previousCode: generated.code,
            stderr: executionEnvelope.stderr || executionEnvelope.errorMessage || "",
            validationFailures: [],
          });

          if (repaired?.code) {
            usedModel = repaired.model;
            usedCode = repaired.code;
            executionEnvelope = await runStage({
              traceId: trace.traceId,
              sessionId: args.session.sessionId,
              stage: "sandbox_execution",
              fn: () =>
                execute_analysis_code({
                  sandboxId: args.session.sandboxId,
                  code: repaired.code,
                  model: repaired.model,
                  onStdout: (line) => {
                    const trimmed = line.trim();
                    if (!trimmed) return;
                    appendQueryStreamEvent(args.session.sessionId, {
                      traceId: trace.traceId,
                      type: "stage_progress",
                      stage: "sandbox_execution",
                      message: trimmed,
                    });
                  },
                  onStderr: (line) => {
                    const trimmed = line.trim();
                    if (!trimmed) return;
                    appendQueryStreamEvent(args.session.sessionId, {
                      traceId: trace.traceId,
                      type: "stage_warning",
                      stage: "sandbox_execution",
                      message: trimmed,
                    });
                  },
                }),
              summarize: (data) => ({
                summary:
                  data.status === "success"
                    ? `Executed repaired sandbox program in ${data.runtimeMs}ms.`
                    : "Repaired sandbox execution failed.",
                rawPreview: previewRaw(data.stderr || data.stdout),
                metadata: {
                  resultSource: data.resultSource,
                  runtimeMs: data.runtimeMs,
                },
              }),
            });
          }
        }

        let parsedCandidate: AnalysisCandidate | null = null;

        if (executionEnvelope.status === "error") {
          analysisState = updateObservability(analysisState, {
            executionFailureCount: 1,
            fallbackCount: 1,
          });
          fallbackDecision = buildFallbackDecision(
            cachedCandidate ? "cached_answer" : "narrative_only",
            executionEnvelope.errorMessage || "Sandbox execution failed before producing a result.",
          );
          validationResult = buildNarrativeFallback(
            "I preserved the current dashboard because the live analysis step did not complete cleanly.",
            0.42,
          );
        } else {
          try {
            const parsed = await runStage({
              traceId: trace.traceId,
              sessionId: args.session.sessionId,
              stage: "sandbox_result_parse",
              fn: async () =>
                parseExecutionResult({
                  resultRaw: executionEnvelope?.resultRaw,
                  stdout: executionEnvelope?.stdout ?? "",
                }),
              summarize: (data) => ({
                summary: `Parsed sandbox result from ${data.source}.`,
                rawPreview: previewRaw(
                  data.source === "file" ? executionEnvelope?.resultRaw : executionEnvelope?.stdout,
                ),
              }),
              fallbackCode:
                executionEnvelope.resultSource === "none"
                  ? "SANDBOX_RESULT_MISSING"
                  : "SANDBOX_RESULT_INVALID_JSON",
            });

            parsedCandidate = parsed.candidate;
            executionEnvelope = {
              ...executionEnvelope,
              artifactPaths: extractArtifactPaths(parsed.candidate.artifacts),
              cacheCandidates: parsed.candidate.cache ?? {},
              resultSource: parsed.source,
            };
          } catch (error) {
            lastStageError = asStageError(error, trace.traceId, "sandbox_result_parse");
            analysisState = updateObservability(analysisState, {
              executionFailureCount: 1,
              fallbackCount: 1,
            });
            fallbackDecision = buildFallbackDecision(
              cachedCandidate ? "cached_answer" : "narrative_only",
              `The analysis failed during ${formatQueryStageLabel(lastStageError.stage)}.`,
            );
            validationResult = buildNarrativeFallback(
              "I preserved the current dashboard because the sandbox returned a malformed machine result.",
              0.42,
            );
          }

          if (!fallbackDecision && parsedCandidate) {
            const candidate = parsedCandidate;
            const envelope = executionEnvelope;
            validationResult = await runStage({
              traceId: trace.traceId,
              sessionId: args.session.sessionId,
              stage: "validation",
              fn: async () =>
                validate_result({
                  route,
                  taskSpec,
                  candidate,
                  session: args.session,
                  sourceTaskId: taskSpec.id,
                  model: envelope.model,
                  artifactPaths: envelope.artifactPaths,
                }),
              summarize: (data) => ({
                summary: `Validated candidate with ${data.kpis.length} KPIs and ${data.panels.length} panels.`,
                rawPreview: data.reasons[0],
              }),
            });

            if (validationResult.status === "rejected") {
              analysisState = updateObservability(analysisState, {
                validationRejectCount: 1,
              });
            }
          }
        }
      }
    }

    const buildCriticSummary = (data: ValidationResult) =>
      JSON.stringify({
        kpis: data.kpis.map((item) => `${item.label}:${item.value}`),
        panels: data.panels.map((item) => item.title),
        insights: data.insights,
        narrative: data.narrative,
      });

    try {
      criticDecision = await runStage({
        traceId: trace.traceId,
        sessionId: args.session.sessionId,
        stage: "critic",
        fn: () =>
          critic_result({
            route,
            taskSpec,
            candidateSummary: buildCriticSummary(validationResult),
            validationReasons: validationResult.reasons,
            existingPanelTitles: args.session.panels.map((item) => item.title),
          }),
        summarize: (data) => ({
          summary: `Critic returned ${data.status}.`,
          rawPreview: data.reasons[0],
        }),
      });
    } catch (error) {
      lastStageError = asStageError(error, trace.traceId, "critic");
      fallbackDecision = buildFallbackDecision(
        "narrative_only",
        "The critic stage could not confirm a safe dashboard mutation.",
      );
      criticDecision = {
        status: "downgrade",
        reasons: [fallbackDecision.reason],
        suggestedRestrictions: [],
      };
    }

    if (
      criticDecision.status === "retry_with_restrictions" &&
      executionEnvelope?.status === "success" &&
      usedCode
    ) {
      const repaired = await repairAnalysisCode({
        profile: args.session.profile!,
        taskSpec: {
          ...taskSpec,
          validationRules: [...taskSpec.validationRules, ...criticDecision.suggestedRestrictions],
        },
        contextSummary,
        previousCode: usedCode,
        stderr: executionEnvelope.stderr,
        validationFailures: validationResult.reasons.concat(criticDecision.reasons),
      });

      if (repaired?.code) {
        usedModel = repaired.model;
        usedCode = repaired.code;
        analysisState = updateObservability(analysisState, { executionCount: 1 });
        executionEnvelope = await runStage({
          traceId: trace.traceId,
          sessionId: args.session.sessionId,
          stage: "sandbox_execution",
          fn: () =>
            execute_analysis_code({
              sandboxId: args.session.sandboxId,
              code: repaired.code,
              model: repaired.model,
              onStdout: (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                appendQueryStreamEvent(args.session.sessionId, {
                  traceId: trace.traceId,
                  type: "stage_progress",
                  stage: "sandbox_execution",
                  message: trimmed,
                });
              },
              onStderr: (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                appendQueryStreamEvent(args.session.sessionId, {
                  traceId: trace.traceId,
                  type: "stage_warning",
                  stage: "sandbox_execution",
                  message: trimmed,
                });
              },
            }),
          summarize: (data) => ({
            summary:
              data.status === "success"
                ? `Executed restricted repair in ${data.runtimeMs}ms.`
                : "Restricted repair execution failed.",
            rawPreview: previewRaw(data.stderr || data.stdout),
          }),
        });

        try {
          const parsed = await runStage({
            traceId: trace.traceId,
            sessionId: args.session.sessionId,
            stage: "sandbox_result_parse",
            fn: async () =>
              parseExecutionResult({
                resultRaw: executionEnvelope?.resultRaw,
                stdout: executionEnvelope?.stdout ?? "",
              }),
            summarize: (data) => ({
              summary: `Parsed repaired sandbox result from ${data.source}.`,
            }),
          });

          executionEnvelope = {
            ...executionEnvelope,
            artifactPaths: extractArtifactPaths(parsed.candidate.artifacts),
            cacheCandidates: parsed.candidate.cache ?? {},
            resultSource: parsed.source,
          };

          validationResult = validate_result({
            route,
            taskSpec,
            candidate: parsed.candidate,
            session: args.session,
            sourceTaskId: taskSpec.id,
            model: executionEnvelope.model,
            artifactPaths: executionEnvelope.artifactPaths,
          });

          criticDecision = await critic_result({
            route,
            taskSpec,
            candidateSummary: buildCriticSummary(validationResult),
            validationReasons: validationResult.reasons,
            existingPanelTitles: args.session.panels.map((item) => item.title),
          });
        } catch (error) {
          lastStageError = asStageError(error, trace.traceId, "sandbox_result_parse");
          fallbackDecision = buildFallbackDecision(
            "narrative_only",
            "The repaired sandbox run still produced an unreadable result.",
          );
          criticDecision = {
            status: "downgrade",
            reasons: [fallbackDecision.reason],
            suggestedRestrictions: [],
          };
        }
      } else {
        fallbackDecision = buildFallbackDecision(
          "narrative_only",
          "The repair stage could not produce a stronger bounded program.",
        );
        criticDecision = {
          status: "downgrade",
          reasons: [fallbackDecision.reason],
          suggestedRestrictions: [],
        };
      }
    }

    if (criticDecision.status === "reject") {
      analysisState = updateObservability(analysisState, { criticRejectCount: 1, fallbackCount: 1 });
    }

    if (criticDecision.status === "downgrade") {
      analysisState = updateObservability(analysisState, { fallbackCount: 1 });
    }

    const mutation = await runStage({
      traceId: trace.traceId,
      sessionId: args.session.sessionId,
      stage: "mutation",
      fn: () =>
        compose_dashboard_mutation({
          session: args.session,
          route,
          taskSpec,
          validationResult,
          criticDecision,
          fallbackDecision,
          cachedCandidate,
        }),
      summarize: (data) => ({
        summary: `Composed ${data.mutationType} mutation.`,
        metadata: {
          preservedExisting: data.preservedExisting,
        },
      }),
    });

    const applied = applyMutation(args.session, mutation);
    const nextAnalysisStateBase: SessionAnalysisState = {
      ...analysisState,
      profile: args.session.profile,
      validatedMetrics: applied.kpis,
      validatedPanels: applied.panels,
      cachedResults: {
        ...analysisState.cachedResults,
        [taskSpec.cacheKey]: {
          title: taskSpec.title,
          kpis: validationResult.kpis,
          panels: validationResult.panels,
          insights: validationResult.insights,
          narrative: validationResult.narrative,
        },
        ...(executionEnvelope?.cacheCandidates ?? {}),
      },
      failedPatterns:
        validationResult.status === "rejected" || executionEnvelope?.status === "error"
          ? Array.from(
              new Set(
                [
                  ...analysisState.failedPatterns,
                  ...(validationResult.reasons.length > 0
                    ? validationResult.reasons
                    : [executionEnvelope?.errorMessage ?? lastStageError?.message ?? "Unknown workflow failure"]),
                ].filter(Boolean),
              ),
            ).slice(-20)
          : analysisState.failedPatterns,
      artifacts: Array.from(
        new Set([
          ...analysisState.artifacts,
          ...(executionEnvelope?.artifactPaths ?? []),
        ]),
      ).slice(-50),
      currentDashboardVersion:
        mutation.mutationType !== "none"
          ? analysisState.currentDashboardVersion + 1
          : analysisState.currentDashboardVersion,
    };

    const finalStatus =
      lastStageError || fallbackDecision || mutation.mutationType === "none" ? "fallback" : "success";
    finalizeQueryTrace({
      traceId: trace.traceId,
      finalStatus,
      failedStage: lastStageError?.stage,
    });

    const traceSummary = summarizeQueryTrace(trace.traceId, lastStageError
      ? { code: lastStageError.code, message: lastStageError.message }
      : undefined);

    const recordedTask: TaskHistoryEntry = {
      id: taskSpec.id,
      queryTraceId: trace.traceId,
      prompt: args.prompt,
      createdAt: nowIso(),
      route,
      taskSpec,
      executionPath,
      model: usedModel,
      code: usedCode,
      executionStatus:
        executionEnvelope?.status === "success"
          ? "success"
          : executionEnvelope?.status === "error"
            ? "error"
            : "not_run",
      validationResult,
      criticDecision,
      fallbackDecision,
      finalMutationType: mutation.mutationType,
      cacheKey: taskSpec.cacheKey,
      artifactPaths: executionEnvelope?.artifactPaths ?? [],
      errorMessage: executionEnvelope?.errorMessage ?? lastStageError?.message,
    };

    const finalAnalysisState = updateObservability(
      {
        ...recordTask(nextAnalysisStateBase, recordedTask),
        lastQueryTraceSummary: traceSummary,
      },
      { totalRuntimeMs: Date.now() - startedAt },
    );

    await runStage({
      traceId: trace.traceId,
      sessionId: args.session.sessionId,
      stage: "persist",
      fn: async () => {
        await writeSessionAnalysisStateToSandbox(sandbox, finalAnalysisState);
        return finalAnalysisState;
      },
      summarize: () => ({
        summary: `Persisted session analysis state and trace ${trace.traceId}.`,
        metadata: {
          traceId: trace.traceId,
        },
      }),
    });

    const suggestedPrompts = await generateSuggestedPrompts({
      profile: args.session.profile!,
      analysisMemory: finalAnalysisState.analysisMemory,
      insights: applied.insights,
    });

    const nextState: DashboardState = {
      ...args.session,
      status: mutation.mutationType === "none" ? "answer_ready" : "dashboard_ready",
      kpis: applied.kpis,
      panels: applied.panels,
      insights: applied.insights,
      suggestedPrompts,
      analysisState: finalAnalysisState,
      messages: [
        ...args.session.messages,
        {
          id: makeId("msg"),
          role: "assistant",
          content: mutation.assistantMessage,
          code: usedCode,
          createdAt: nowIso(),
        },
      ],
    };

    appendQueryStreamEvent(args.session.sessionId, {
      traceId: trace.traceId,
      type: "analysis_complete",
      stage: "stream",
      message: "Analysis complete. Syncing dashboard state.",
    });
    completeQueryStream(args.session.sessionId, trace.traceId);

    return nextState;
  } catch (error) {
    const stageError = asStageError(error, trace.traceId, "request_intake");
    finalizeQueryTrace({
      traceId: trace.traceId,
      finalStatus: "error",
      failedStage: stageError.stage,
    });
    appendQueryStreamEvent(args.session.sessionId, {
      traceId: trace.traceId,
      type: "stage_failed",
      stage: stageError.stage,
      message: stageError.message,
      payload: { code: stageError.code },
    });
    completeQueryStream(args.session.sessionId, trace.traceId);
    throw stageError;
  }
};
