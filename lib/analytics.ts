import OpenAI from "openai";
import { env, hasLLM } from "@/lib/env";
import type {
  AnalysisRoute,
  CriticDecision,
  DashboardPanel,
  DatasetProfile,
  KPI,
  TaskSpec,
} from "@/lib/types";
import { makeId } from "@/lib/utils";

const llmClient = hasLLM
  ? new OpenAI({
      apiKey: env.mistralApiKey,
      baseURL: env.mistralBaseUrl,
    })
  : null;

const parseMessageContent = (content: unknown) =>
  typeof content === "string" ? content : JSON.stringify(content ?? {});

const callJsonModel = async <T>(
  model: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
) => {
  if (!llmClient) {
    return null;
  }

  const response = await llmClient.chat.completions.create({
    model,
    response_format: {
      type: "json_object",
    },
    messages,
  });

  const content = parseMessageContent(response.choices[0]?.message?.content);
  if (!content) {
    return null;
  }

  return JSON.parse(content) as T;
};

const heuristicRoute = (prompt: string): AnalysisRoute => {
  const normalizedPrompt = prompt.toLowerCase();

  if (/\bdebug|diagnostic|why did|what happened|error\b/.test(normalizedPrompt)) {
    return {
      id: makeId("route"),
      requestClass: "diagnostic",
      scope: "cached_only",
      confidence: 0.78,
      urgency: "medium",
      allowedFallbackDepth: 6,
      shouldMutateDashboard: false,
      summary: "Diagnostic explanation request.",
    };
  }

  if (/\bdashboard|reshape|restructure|executive|redo|refresh\b/.test(normalizedPrompt)) {
    return {
      id: makeId("route"),
      requestClass: "dashboard_refresh",
      scope: "full_rebuild",
      confidence: 0.84,
      urgency: "high",
      allowedFallbackDepth: 7,
      shouldMutateDashboard: true,
      summary: "Dashboard-wide refresh request.",
    };
  }

  if (/\bkpi|metric|headline\b/.test(normalizedPrompt)) {
    return {
      id: makeId("route"),
      requestClass: "kpi_update",
      scope: "incremental_execution",
      confidence: 0.77,
      urgency: "medium",
      allowedFallbackDepth: 5,
      shouldMutateDashboard: true,
      summary: "Metric refresh request.",
    };
  }

  if (/\bchart|plot|graph|trend|scatter|bar\b/.test(normalizedPrompt)) {
    return {
      id: makeId("route"),
      requestClass: "panel_add",
      scope: "incremental_execution",
      confidence: 0.76,
      urgency: "medium",
      allowedFallbackDepth: 5,
      shouldMutateDashboard: true,
      summary: "Requested a chart panel.",
    };
  }

  if (/\btable|top\b/.test(normalizedPrompt)) {
    return {
      id: makeId("route"),
      requestClass: "panel_replace",
      scope: "incremental_execution",
      confidence: 0.74,
      urgency: "medium",
      allowedFallbackDepth: 5,
      shouldMutateDashboard: true,
      summary: "Requested a table panel.",
    };
  }

  return {
    id: makeId("route"),
    requestClass: "answer",
    scope: "cached_only",
    confidence: 0.72,
    urgency: "low",
    allowedFallbackDepth: 6,
    shouldMutateDashboard: false,
    summary: "Narrative answer request.",
  };
};

const heuristicTaskSpec = (route: AnalysisRoute, prompt: string): TaskSpec => {
  const responseType =
    route.requestClass === "dashboard_refresh"
      ? "dashboard"
      : route.requestClass === "kpi_update"
        ? "dashboard"
        : route.requestClass === "panel_add"
          ? "chart"
          : route.requestClass === "panel_replace"
            ? "table"
            : "text";

  return {
    id: makeId("task"),
    kind:
      responseType === "dashboard"
        ? "dashboard_composition"
        : responseType === "chart"
          ? "chart"
          : responseType === "table"
            ? "table"
            : "narrative",
    title:
      route.requestClass === "dashboard_refresh"
        ? "Dashboard refresh"
        : route.requestClass === "kpi_update"
          ? "KPI refresh"
          : route.requestClass === "panel_add"
            ? "Generated chart"
            : route.requestClass === "panel_replace"
              ? "Generated table"
              : "Narrative answer",
    userPrompt: prompt,
    businessQuestion: prompt,
    responseType,
    executionPath:
      route.requestClass === "answer" || route.requestClass === "diagnostic"
        ? "narrative_only"
        : "run_python",
    acceptablePanelKinds:
      responseType === "chart"
        ? ["plotly"]
        : responseType === "table"
          ? ["table"]
          : responseType === "dashboard"
            ? ["plotly", "table", "html"]
            : [],
    displayConstraints: {
      maxKpis: 4,
      maxPanels: responseType === "dashboard" ? 3 : 1,
      maxRows: 5,
      maxLabelLength: 28,
      maxValueLength: 18,
      investorMode: true,
    },
    cacheKey: `${route.requestClass}:${prompt.trim().toLowerCase()}`,
    validationRules: [
      "No raw long-form 13+ digit KPI values",
      "No empty top-N tables",
      "Keep labels concise and stakeholder-readable",
    ],
    expectedOutputs: {
      narrative: true,
      kpis: responseType === "dashboard",
      panels: responseType === "chart" || responseType === "table" || responseType === "dashboard",
    },
    routeClass: route.requestClass,
    scope: route.scope,
    successCriteria: [
      "Answer the user request directly",
      "Keep the output readable in the dashboard shell",
      "Return only validated, bounded artifacts",
    ],
  };
};

export const parseExplorePayload = (raw: string) => {
  const profileLine = raw
    .split("\n")
    .find((line) => line.startsWith("EXPLORE_JSON:"));

  if (!profileLine) {
    throw new Error("Explore script did not return EXPLORE_JSON payload.");
  }

  return JSON.parse(profileLine.replace("EXPLORE_JSON:", "")) as {
    profile: DatasetProfile;
    kpis: KPI[];
    panels: DashboardPanel[];
    insights: string[];
  };
};

export const buildInitialDashboard = (payload: {
  profile: DatasetProfile;
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
}) => payload;

const fallbackSuggestedPrompts = (profile: DatasetProfile) => {
  const prompts = [
    `Build an executive dashboard for ${profile.filename} with the most important KPIs and supporting charts.`,
    `Summarize the biggest patterns, concentration, and outliers in ${profile.filename}.`,
  ];

  if (profile.categoricalColumns[0] && profile.numericColumns[0]) {
    prompts.push(
      `Compare the top ${profile.categoricalColumns[0]} values by ${profile.numericColumns[0]} and explain the biggest drivers.`,
    );
  }

  if (profile.datetimeColumns[0] && profile.numericColumns[0]) {
    prompts.push(
      `Show the trend of ${profile.numericColumns[0]} over ${profile.datetimeColumns[0]} and call out notable shifts.`,
    );
  }

  prompts.push(
    `Recommend how to restructure this dashboard for a stakeholder demo and generate the best KPI and chart mix.`,
  );

  return prompts.slice(0, 5);
};

export const generateSuggestedPrompts = async (args: {
  profile: DatasetProfile;
  insights?: string[];
}) => {
  const fallback = fallbackSuggestedPrompts(args.profile);
  const parsed = await callJsonModel<{ suggestedPrompts?: string[] }>(
    env.mistralSummaryModel,
    [
      {
        role: "system",
        content:
          "You generate concise analytics follow-up prompts. Return strict JSON with a single key `suggestedPrompts`, whose value is an array of 3 to 5 short user-ready prompts. Each prompt should be specific to the dataset context, useful for a dashboard demo, and phrased as something the user can click to run. Prefer prompts that ask for KPI summaries, chart comparisons, anomalies, concentration, trends, or stakeholder-friendly dashboard reshapes.",
      },
      {
        role: "user",
        content: JSON.stringify(args),
      },
    ],
  );

  const suggestedPrompts = Array.isArray(parsed?.suggestedPrompts)
    ? parsed.suggestedPrompts
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return suggestedPrompts.length > 0 ? suggestedPrompts : fallback;
};

export const routeAnalysisRequest = async (args: {
  profile: DatasetProfile;
  prompt: string;
  contextSummary: string;
}) => {
  const fallback = heuristicRoute(args.prompt);
  const parsed = await callJsonModel<{
    requestClass?: AnalysisRoute["requestClass"];
    scope?: AnalysisRoute["scope"];
    confidence?: number;
    urgency?: AnalysisRoute["urgency"];
    allowedFallbackDepth?: number;
    shouldMutateDashboard?: boolean;
    summary?: string;
  }>(env.mistralRouterModel, [
    {
      role: "system",
      content:
        "You are the routing stage of an analytics agent. Return strict JSON with keys requestClass, scope, confidence, urgency, allowedFallbackDepth, shouldMutateDashboard, and summary. Allowed requestClass values: answer, kpi_update, panel_add, panel_replace, dashboard_refresh, diagnostic. Allowed scope values: cached_only, incremental_execution, full_rebuild. Narrative or explanatory asks should not mutate the dashboard by default.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (!parsed) {
    return fallback;
  }

  return {
    id: makeId("route"),
    requestClass: parsed.requestClass ?? fallback.requestClass,
    scope: parsed.scope ?? fallback.scope,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : fallback.confidence,
    urgency:
      parsed.urgency === "high" || parsed.urgency === "medium" || parsed.urgency === "low"
        ? parsed.urgency
        : fallback.urgency,
    allowedFallbackDepth:
      typeof parsed.allowedFallbackDepth === "number"
        ? Math.max(1, Math.min(7, Math.round(parsed.allowedFallbackDepth)))
        : fallback.allowedFallbackDepth,
    shouldMutateDashboard:
      typeof parsed.shouldMutateDashboard === "boolean"
        ? parsed.shouldMutateDashboard
        : fallback.shouldMutateDashboard,
    summary: parsed.summary?.trim() || fallback.summary,
  } satisfies AnalysisRoute;
};

export const createTaskSpec = async (args: {
  route: AnalysisRoute;
  profile: DatasetProfile;
  prompt: string;
  contextSummary: string;
}) => {
  const fallback = heuristicTaskSpec(args.route, args.prompt);
  const parsed = await callJsonModel<Partial<TaskSpec>>(env.mistralRouterModel, [
    {
      role: "system",
      content:
        "You are the task planning stage of an analytics agent. Return strict JSON shaped like a TaskSpec with keys kind, title, businessQuestion, responseType, executionPath, acceptablePanelKinds, displayConstraints, cacheKey, validationRules, expectedOutputs, successCriteria. Do not emit final UI payloads. Do not emit Python code. Keep the task bounded and execution-safe.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (!parsed) {
    return fallback;
  }

  return {
    ...fallback,
    kind:
      parsed.kind === "metric" ||
      parsed.kind === "table" ||
      parsed.kind === "chart" ||
      parsed.kind === "narrative" ||
      parsed.kind === "dashboard_composition"
        ? parsed.kind
        : fallback.kind,
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
    businessQuestion:
      typeof parsed.businessQuestion === "string" && parsed.businessQuestion.trim()
        ? parsed.businessQuestion.trim()
        : fallback.businessQuestion,
    responseType:
      parsed.responseType === "chart" ||
      parsed.responseType === "table" ||
      parsed.responseType === "html" ||
      parsed.responseType === "text" ||
      parsed.responseType === "dashboard"
        ? parsed.responseType
        : fallback.responseType,
    executionPath:
      parsed.executionPath === "use_cache" ||
      parsed.executionPath === "run_python" ||
      parsed.executionPath === "repair_python" ||
      parsed.executionPath === "downgrade_scope" ||
      parsed.executionPath === "narrative_only"
        ? parsed.executionPath
        : fallback.executionPath,
    acceptablePanelKinds: Array.isArray(parsed.acceptablePanelKinds)
      ? parsed.acceptablePanelKinds.filter(
          (item): item is DashboardPanel["kind"] =>
            item === "plotly" || item === "table" || item === "html",
        )
      : fallback.acceptablePanelKinds,
    displayConstraints: {
      ...fallback.displayConstraints,
      ...parsed.displayConstraints,
    },
    cacheKey:
      typeof parsed.cacheKey === "string" && parsed.cacheKey.trim()
        ? parsed.cacheKey.trim()
        : fallback.cacheKey,
    validationRules: Array.isArray(parsed.validationRules)
      ? parsed.validationRules.filter((item): item is string => typeof item === "string").slice(0, 8)
      : fallback.validationRules,
    expectedOutputs: {
      ...fallback.expectedOutputs,
      ...parsed.expectedOutputs,
    },
    successCriteria: Array.isArray(parsed.successCriteria)
      ? parsed.successCriteria.filter((item): item is string => typeof item === "string").slice(0, 6)
      : fallback.successCriteria,
  } satisfies TaskSpec;
};

export const generateAnalysisCode = async (args: {
  profile: DatasetProfile;
  taskSpec: TaskSpec;
  contextSummary: string;
  priorFailures?: string[];
}) => {
  const parsed = await callJsonModel<{
    code?: string;
    expectedArtifacts?: string[];
  }>(env.mistralCodeModel, [
    {
      role: "system",
      content:
        "You generate Python pandas analysis code for an E2B sandbox. Return strict JSON with keys code and expectedArtifacts. The code must read /home/user/data.csv, may use pandas/numpy/json, and must print exactly one line prefixed VIEWPILOT_RESULT: followed by a JSON object. The JSON envelope may contain keys title, narrative, kpis, panels, insights, cache, artifacts. Panels must be either plotly or table panels shaped for a dashboard. Keep the task bounded and stakeholder-ready. Never return markdown fences.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (parsed?.code?.trim()) {
    return {
      model: env.mistralCodeModel,
      code: parsed.code.trim(),
      expectedArtifacts: Array.isArray(parsed.expectedArtifacts)
        ? parsed.expectedArtifacts.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  return null;
};

export const repairAnalysisCode = async (args: {
  profile: DatasetProfile;
  taskSpec: TaskSpec;
  contextSummary: string;
  previousCode: string;
  stderr: string;
  validationFailures: string[];
}) => {
  const parsed = await callJsonModel<{
    code?: string;
    expectedArtifacts?: string[];
  }>(env.mistralCodeModel, [
    {
      role: "system",
      content:
        "You repair Python pandas analysis code for an E2B sandbox. Return strict JSON with keys code and expectedArtifacts. Fix the failure using the stderr and validation feedback. Keep the code bounded to the original task. The repaired code must still print exactly one line prefixed VIEWPILOT_RESULT: followed by a JSON object.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (parsed?.code?.trim()) {
    return {
      model: env.mistralCodeModel,
      code: parsed.code.trim(),
      expectedArtifacts: Array.isArray(parsed.expectedArtifacts)
        ? parsed.expectedArtifacts.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  return null;
};

export const criticResult = async (args: {
  route: AnalysisRoute;
  taskSpec: TaskSpec;
  candidateSummary: string;
  validationReasons: string[];
  existingPanelTitles: string[];
}) => {
  const parsed = await callJsonModel<{
    status?: CriticDecision["status"];
    reasons?: string[];
    suggestedRestrictions?: string[];
  }>(env.mistralCriticModel, [
    {
      role: "system",
      content:
        "You are the critic stage of an analytics agent. Evaluate usefulness, readability, and redundancy. Return strict JSON with keys status, reasons, and suggestedRestrictions. Allowed status values: approve, approve_with_trim, retry_with_restrictions, downgrade, reject. Do not generate code.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (!parsed) {
    return {
      status: args.validationReasons.length > 0 ? "reject" : "approve",
      reasons:
        args.validationReasons.length > 0
          ? args.validationReasons
          : ["Validated output is suitable for delivery."],
      suggestedRestrictions: [],
    } satisfies CriticDecision;
  }

  return {
    status:
      parsed.status === "approve" ||
      parsed.status === "approve_with_trim" ||
      parsed.status === "retry_with_restrictions" ||
      parsed.status === "downgrade" ||
      parsed.status === "reject"
        ? parsed.status
        : args.validationReasons.length > 0
          ? "reject"
          : "approve",
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((item): item is string => typeof item === "string").slice(0, 6)
      : [],
    suggestedRestrictions: Array.isArray(parsed.suggestedRestrictions)
      ? parsed.suggestedRestrictions
          .filter((item): item is string => typeof item === "string")
          .slice(0, 6)
      : [],
  } satisfies CriticDecision;
};

export const composeAssistantMessage = async (args: {
  prompt: string;
  route: AnalysisRoute;
  taskSpec: TaskSpec;
  mutationSummary: string;
  insights: string[];
  narrative?: string;
}) => {
  const parsed = await callJsonModel<{ message?: string }>(env.mistralSummaryModel, [
    {
      role: "system",
      content:
        "You compose concise investor-grade analytics assistant responses. Return strict JSON with a single key `message`. The message should explain what was updated or why the dashboard was preserved, with crisp stakeholder language.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (parsed?.message?.trim()) {
    return parsed.message.trim();
  }

  if (args.narrative?.trim()) {
    return args.narrative.trim();
  }

  return args.mutationSummary;
};
