import { createHash } from "node:crypto";
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
import type {
  AnalysisCandidate,
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
  SessionAnalysisState,
  TaskHistoryEntry,
  TaskSpec,
  ValidationResult,
} from "@/lib/types";
import { makeId, nowIso } from "@/lib/utils";

const EMPTY_CELL = "—";
const RESULT_PREFIX = "VIEWPILOT_RESULT:";

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
    if (columns.length === 0 || rows.length === 0) {
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
    validatedMetricLabels: analysisState.validatedMetrics.map((item) => item.label).slice(0, 6),
    validatedPanelTitles: analysisState.validatedPanels.map((item) => item.title).slice(0, 8),
    cachedKeys: Object.keys(analysisState.cachedResults).slice(0, 10),
    failedPatterns: analysisState.failedPatterns.slice(-5),
    recentPrompts: session.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .slice(-4),
  });

const parseExecutionResult = (stdout: string) => {
  const resultLine = stdout
    .split("\n")
    .find((line) => line.startsWith(RESULT_PREFIX));

  if (!resultLine) {
    return null;
  }

  return JSON.parse(resultLine.replace(RESULT_PREFIX, "")) as AnalysisCandidate;
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

  if (args.route.requestClass === "dashboard_refresh" && panels.length < 2 && kpis.length < 2) {
    reasons.push("Dashboard refresh needs stronger evidence than a partial result.");
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
        panels: mutation.panels.length > 0 ? mutation.panels : session.panels,
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
}) => {
  const sandbox = await connectSandbox(args.sandboxId);
  const execution = await runPythonAnalysis(sandbox, args.code);
  const parsed = parseExecutionResult(execution.stdout);

  return {
    status: execution.error ? "error" : parsed ? "success" : "error",
    code: args.code,
    model: args.model,
    result: parsed ?? undefined,
    stdout: execution.stdout,
    stderr: execution.stderr,
    errorMessage:
      execution.error?.value ||
      execution.error?.traceback ||
      (!parsed ? "The execution did not emit a VIEWPILOT_RESULT envelope." : undefined),
    artifactPaths:
      parsed?.artifacts?.filter((item): item is string => typeof item === "string") ?? [],
    runtimeMs: execution.runtimeMs,
    cacheCandidates: parsed?.cache ?? {},
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
  const { sandbox, analysisState: loadedState, contextSummary } = await load_session_context(args.session);
  let analysisState = updateObservability(loadedState, { requestCount: 1 });

  const route = await routeAnalysisRequest({
    profile: args.session.profile!,
    prompt: args.prompt,
    contextSummary,
  });

  const taskSpec = await create_task_spec({
    route,
    profile: args.session.profile!,
    prompt: args.prompt,
    contextSummary,
  });

  const cachedCandidate = load_cached_result(analysisState, taskSpec.cacheKey);
  const executionPath: ExecutionPath =
    cachedCandidate && route.scope !== "full_rebuild" ? "use_cache" : taskSpec.executionPath;

  let executionEnvelope: ExecutionEnvelope | null = null;
  let validationResult: ValidationResult;
  let criticDecision: CriticDecision;
  let fallbackDecision: FallbackDecision | undefined;
  let usedModel = "none";
  let usedCode: string | undefined;

  if (executionPath === "use_cache" && cachedCandidate) {
    analysisState = updateObservability(analysisState, { cacheHitCount: 1 });
    validationResult = validate_result({
      route,
      taskSpec: { ...taskSpec, executionPath },
      candidate: cachedCandidate,
      session: args.session,
      sourceTaskId: makeId("cache"),
      model: "cache",
      artifactPaths: [],
    });
  } else if (executionPath === "narrative_only") {
    fallbackDecision = buildFallbackDecision(
      "narrative_only",
      "This request is better served as a narrative explanation than a dashboard mutation.",
    );
    validationResult = {
      status: "approved",
      reasons: [],
      kpis: [],
      panels: [],
      insights: [],
      narrative:
        cachedCandidate?.narrative ||
        "I preserved the current dashboard and focused on a concise narrative answer for this request.",
      confidence: route.confidence,
    };
  } else {
    const generated = await generate_analysis_code({
      profile: args.session.profile!,
      taskSpec,
      contextSummary,
      priorFailures: analysisState.failedPatterns,
    });

    if (!generated) {
      fallbackDecision = buildFallbackDecision(
        cachedCandidate ? "cached_answer" : "narrative_only",
        "The code generation stage did not return a bounded analysis program.",
      );
      validationResult = {
        status: "approved",
        reasons: [],
        kpis: [],
        panels: [],
        insights: [],
        narrative:
          cachedCandidate?.narrative ||
          "I preserved the current dashboard because the analysis engine did not produce a reliable bounded program for this request.",
        confidence: 0.5,
      };
    } else {
      usedModel = generated.model;
      usedCode = generated.code;
      analysisState = updateObservability(analysisState, { executionCount: 1 });
      executionEnvelope = await execute_analysis_code({
        sandboxId: args.session.sandboxId,
        code: generated.code,
        model: generated.model,
      });

      if (
        executionEnvelope.status === "error" &&
        generated.code &&
        route.allowedFallbackDepth > 2
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
          executionEnvelope = await execute_analysis_code({
            sandboxId: args.session.sandboxId,
            code: repaired.code,
            model: repaired.model,
          });
        }
      }

      if (executionEnvelope.status === "error" || !executionEnvelope.result) {
        analysisState = updateObservability(analysisState, {
          executionFailureCount: 1,
          fallbackCount: 1,
        });
        fallbackDecision = buildFallbackDecision(
          cachedCandidate ? "cached_answer" : "narrative_only",
          executionEnvelope.errorMessage || "Execution failed before producing a valid result envelope.",
        );
        validationResult = {
          status: "approved",
          reasons: [],
          kpis: [],
          panels: [],
          insights: [],
          narrative:
            cachedCandidate?.narrative ||
            "I preserved the current dashboard because the live analysis step did not complete cleanly.",
          confidence: 0.42,
        };
      } else {
        validationResult = validate_result({
          route,
          taskSpec,
          candidate: executionEnvelope.result,
          session: args.session,
          sourceTaskId: taskSpec.id,
          model: executionEnvelope.model,
          artifactPaths: executionEnvelope.artifactPaths,
        });

        if (validationResult.status === "rejected") {
          analysisState = updateObservability(analysisState, {
            validationRejectCount: 1,
          });
        }
      }
    }
  }

  criticDecision = await critic_result({
    route,
    taskSpec,
    candidateSummary: JSON.stringify({
      kpis: validationResult.kpis.map((item) => `${item.label}:${item.value}`),
      panels: validationResult.panels.map((item) => item.title),
      insights: validationResult.insights,
      narrative: validationResult.narrative,
    }),
    validationReasons: validationResult.reasons,
    existingPanelTitles: args.session.panels.map((item) => item.title),
  });

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
      executionEnvelope = await execute_analysis_code({
        sandboxId: args.session.sandboxId,
        code: repaired.code,
        model: repaired.model,
      });

      if (executionEnvelope.status === "success" && executionEnvelope.result) {
        validationResult = validate_result({
          route,
          taskSpec,
          candidate: executionEnvelope.result,
          session: args.session,
          sourceTaskId: taskSpec.id,
          model: executionEnvelope.model,
          artifactPaths: executionEnvelope.artifactPaths,
        });
        criticDecision = await critic_result({
          route,
          taskSpec,
          candidateSummary: JSON.stringify({
            kpis: validationResult.kpis.map((item) => `${item.label}:${item.value}`),
            panels: validationResult.panels.map((item) => item.title),
            insights: validationResult.insights,
            narrative: validationResult.narrative,
          }),
          validationReasons: validationResult.reasons,
          existingPanelTitles: args.session.panels.map((item) => item.title),
        });
      } else {
        fallbackDecision = buildFallbackDecision(
          "narrative_only",
          executionEnvelope.errorMessage || "Repair attempt failed.",
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

  const mutation = await compose_dashboard_mutation({
    session: args.session,
    route,
    taskSpec,
    validationResult,
    criticDecision,
    fallbackDecision,
    cachedCandidate,
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
              [...analysisState.failedPatterns, ...(validationResult.reasons.length > 0 ? validationResult.reasons : [executionEnvelope?.errorMessage ?? "Unknown workflow failure"])]
                .filter(Boolean),
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

  const recordedTask: TaskHistoryEntry = {
    id: taskSpec.id,
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
    errorMessage: executionEnvelope?.errorMessage,
  };

  const finalAnalysisState = updateObservability(
    recordTask(nextAnalysisStateBase, recordedTask),
    { totalRuntimeMs: Date.now() - startedAt },
  );

  await writeSessionAnalysisStateToSandbox(sandbox, finalAnalysisState);

  const suggestedPrompts = await generateSuggestedPrompts({
    profile: args.session.profile!,
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

  return nextState;
};
