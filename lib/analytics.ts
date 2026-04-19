import OpenAI from "openai";
import { buildRecommendationsFromMemory, selectRecommendationForPrompt } from "@/lib/chart-recommendation";
import { inferCompositionPlan } from "@/lib/composition-templates";
import { env, hasLLM } from "@/lib/env";
import type {
  AnalysisMemory,
  AnalysisRoute,
  AnalysisOpportunity,
  CriticDecision,
  DashboardPanel,
  DatasetProfile,
  KPI,
  PanelTarget,
  TaskSpec,
} from "@/lib/types";
import { makeId } from "@/lib/utils";

const llmClient = hasLLM
  ? new OpenAI({
      apiKey: env.mistralApiKey,
      baseURL: env.mistralBaseUrl,
    })
  : null;

const parseMessageContent = (content: unknown) => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          const text = part.text;
          return typeof text === "string" ? text : "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return JSON.stringify(content ?? {});
};

const extractJsonObject = (content: string) => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }

    throw new Error("Model did not return a valid JSON object.");
  }
};

const sanitizeAssistantMessage = (message: string) =>
  message
    .replace(/�+\?+/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

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

  try {
    return extractJsonObject(content) as T;
  } catch {
    return null;
  }
};

const ordinalIndexMap: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
};

const normalizeText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const tokenizeText = (value: string) =>
  normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !["chart", "panel", "graph", "plot", "table"].includes(token));

const extractPanelTarget = (
  prompt: string,
  existingPanels: DashboardPanel[] = [],
): PanelTarget | undefined => {
  const normalizedPrompt = normalizeText(prompt);
  const promptTokens = tokenizeText(prompt);

  if (/\b(histogram|box plot|boxplot|pie chart|donut|bar chart|table)\b/.test(normalizedPrompt)) {
    const transformCandidates = existingPanels
      .map((panel, index) => {
        const panelTokens = new Set(tokenizeText(`${panel.title} ${panel.description}`));
        const overlap = promptTokens.filter((token) => panelTokens.has(token));
        const traceType =
          panel.kind === "plotly" && panel.spec.data[0] && typeof panel.spec.data[0].type === "string"
            ? panel.spec.data[0].type.toLowerCase()
            : "";
        const score =
          overlap.length +
          (normalizedPrompt.includes("histogram") && traceType === "histogram" ? 2 : 0) +
          ((normalizedPrompt.includes("box plot") || normalizedPrompt.includes("boxplot")) && traceType === "histogram" ? 2 : 0) +
          ((normalizedPrompt.includes("pie chart") || normalizedPrompt.includes("donut")) && traceType === "bar" ? 2 : 0);
        return { panel, index, score };
      })
      .filter((item) => item.score >= 2)
      .sort((a, b) => b.score - a.score);

    if (transformCandidates[0]) {
      return {
        index: transformCandidates[0].index,
        title: transformCandidates[0].panel.title,
        matchType: "title",
        confidence: Math.min(0.94, 0.62 + transformCandidates[0].score * 0.06),
      };
    }
  }

  const ordinalMatch = normalizedPrompt.match(/\b(first|second|third|fourth|fifth)\s+(chart|panel|graph|table)\b/);
  if (ordinalMatch) {
    const index = ordinalIndexMap[ordinalMatch[1]];
    if (index != null && existingPanels[index]) {
      return {
        index,
        title: existingPanels[index].title,
        matchType: "ordinal",
        confidence: 0.92,
      };
    }
  }

  const titleMatch = existingPanels.find((panel) => {
    const normalizedTitle = normalizeText(panel.title);
    return normalizedTitle.length > 3 && normalizedPrompt.includes(normalizedTitle);
  });

  if (titleMatch) {
    return {
      index: existingPanels.findIndex((panel) => panel.id === titleMatch.id),
      title: titleMatch.title,
      matchType: "title",
      confidence: 0.88,
    };
  }

  if (/\b(this|that|current)\s+(chart|panel|graph|table)\b/.test(normalizedPrompt) && existingPanels[0]) {
    return {
      index: 0,
      title: existingPanels[0].title,
      matchType: "implicit",
      confidence: 0.58,
    };
  }

  const fuzzyMatches = existingPanels
    .map((panel, index) => {
      const panelTokens = new Set(tokenizeText(`${panel.title} ${panel.description}`));
      const overlap = promptTokens.filter((token) => panelTokens.has(token));
      return {
        panel,
        index,
        overlap,
      };
    })
    .filter((match) => match.overlap.length >= 2)
    .sort((a, b) => b.overlap.length - a.overlap.length);

  if (fuzzyMatches[0]) {
    return {
      index: fuzzyMatches[0].index,
      title: fuzzyMatches[0].panel.title,
      matchType: "title",
      confidence: Math.min(0.88, 0.58 + fuzzyMatches[0].overlap.length * 0.08),
    };
  }

  return undefined;
};

const heuristicRoute = (prompt: string, existingPanels: DashboardPanel[] = []): AnalysisRoute => {
  const normalizedPrompt = prompt.toLowerCase();
  const wantsMetrics = /\bkpi|metric|headline|summary|summarize\b/.test(normalizedPrompt);
  const wantsChart = /\bchart|plot|graph|trend|scatter|bar\b/.test(normalizedPrompt);
  const wantsTable = /\btable|top\b/.test(normalizedPrompt);
  const wantsTransform = /\b(convert|change|turn|switch|replace|make)\b/.test(normalizedPrompt);
  const panelTarget = extractPanelTarget(prompt, existingPanels);

  if (wantsTransform && panelTarget) {
    return {
      id: makeId("route"),
      requestClass: panelTarget.confidence >= 0.75 ? "panel_replace" : "dashboard_refresh",
      scope: "incremental_execution",
      confidence: panelTarget.confidence,
      urgency: "medium",
      allowedFallbackDepth: 5,
      shouldMutateDashboard: true,
      summary: `Transform the targeted panel ${panelTarget.title ? `(${panelTarget.title})` : "in place"}.`,
    };
  }

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

  if ((wantsMetrics && wantsChart) || (wantsMetrics && wantsTable)) {
    return {
      id: makeId("route"),
      requestClass: "dashboard_refresh",
      scope: "full_rebuild",
      confidence: 0.88,
      urgency: "high",
      allowedFallbackDepth: 6,
      shouldMutateDashboard: true,
      summary: "Composite request for metrics plus supporting visuals.",
    };
  }

  if (wantsMetrics) {
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

  if (wantsChart) {
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

  if (wantsTable) {
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

const pickOpportunity = (
  memory: AnalysisMemory | undefined,
  kind: AnalysisOpportunity["kind"],
) => memory?.opportunities.find((item) => item.kind === kind);

const inferHeuristicRoute = (
  prompt: string,
  memory?: AnalysisMemory,
  existingPanels: DashboardPanel[] = [],
) => {
  const fallback = heuristicRoute(prompt, existingPanels);
  const normalizedPrompt = prompt.toLowerCase();
  const wantsDistribution = /\bdistribution|spread|histogram|variance|quartile|box\b/.test(
    normalizedPrompt,
  );
  const wantsTrend = /\btrend|over time|month|quarter|year|timeline\b/.test(normalizedPrompt);
  const wantsComparison = /\bcompare|vs\b/.test(normalizedPrompt);

  if (wantsTrend && memory?.dateCandidates.length) {
    return {
      ...fallback,
      requestClass: "dashboard_refresh",
      scope: "full_rebuild",
      confidence: 0.9,
      summary: `Time-series analysis using ${memory.dateCandidates[0]}.`,
    } satisfies AnalysisRoute;
  }

  if (wantsDistribution && pickOpportunity(memory, "distribution")) {
    return {
      ...fallback,
      requestClass: /\bsummarize|summary|metric\b/.test(normalizedPrompt)
        ? "dashboard_refresh"
        : "panel_add",
      scope: "incremental_execution",
      confidence: 0.86,
      summary: "Distribution-focused exploratory request.",
    } satisfies AnalysisRoute;
  }

  if (wantsComparison && pickOpportunity(memory, "comparison")) {
    return {
      ...fallback,
      requestClass: "dashboard_refresh",
      scope: "full_rebuild",
      confidence: 0.87,
      summary: "Comparison request backed by candidate dimensions and measures.",
    } satisfies AnalysisRoute;
  }

  return fallback;
};

const heuristicTaskSpec = (
  route: AnalysisRoute,
  prompt: string,
  analysisMemory?: AnalysisMemory,
): TaskSpec => {
  const selectedRecommendation = selectRecommendationForPrompt({
    prompt,
    memory: analysisMemory
      ? {
          ...analysisMemory,
          recommendations:
            analysisMemory.recommendations?.length
              ? analysisMemory.recommendations
              : buildRecommendationsFromMemory(analysisMemory),
        }
      : undefined,
  });
  const composition = inferCompositionPlan({ route, prompt });
  const inferredResponseType =
    selectedRecommendation?.mark === "table"
      ? "table"
      : selectedRecommendation?.mark
        ? "chart"
        : undefined;
  const responseType =
    route.requestClass === "dashboard_refresh"
      ? "dashboard"
      : route.requestClass === "kpi_update"
        ? "dashboard"
        : route.requestClass === "panel_add"
          ? "chart"
          : route.requestClass === "panel_replace"
            ? inferredResponseType ?? "chart"
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
              ? inferredResponseType === "table"
                ? "Generated table"
                : "Transformed chart"
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
      maxKpis: composition.targetKpis || 4,
      maxPanels: responseType === "dashboard" ? composition.targetPanels : 1,
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
      kpis: composition.targetKpis > 0 && responseType === "dashboard",
      panels:
        responseType === "chart" || responseType === "table" || composition.targetPanels > 0,
    },
    routeClass: route.requestClass,
    scope: route.scope,
    selectedRecommendationId: selectedRecommendation?.id,
    composition,
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
    analysisMemory: AnalysisMemory;
    kpis: KPI[];
    panels: DashboardPanel[];
    insights: string[];
  };
};

export const buildInitialDashboard = (payload: {
  profile: DatasetProfile;
  analysisMemory: AnalysisMemory;
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
}) => payload;

const fallbackSuggestedPrompts = (
  profile: DatasetProfile,
  analysisMemory?: AnalysisMemory,
  existingPanels?: DashboardPanel[],
) => {
  const prompts: string[] = [];

  const rankingOpportunity = pickOpportunity(analysisMemory, "ranking");
  const distributionOpportunity = pickOpportunity(analysisMemory, "distribution");
  const trendOpportunity = pickOpportunity(analysisMemory, "time_trend");
  const dataQualityOpportunity = pickOpportunity(analysisMemory, "data_quality");
  const primaryPanelTitle = existingPanels?.[0]?.title;

  if (primaryPanelTitle) {
    prompts.push(`Explain what the panel titled "${primaryPanelTitle}" says and what a stakeholder should notice first.`);
  }

  if (rankingOpportunity?.dimension && rankingOpportunity.measure) {
    prompts.push(
      `Show the top 5 ${rankingOpportunity.dimension.replace(/_/g, " ")} values by ${rankingOpportunity.measure.replace(/_/g, " ")} and explain what drives the leaders.`,
    );
  } else if (profile.categoricalColumns[0] && profile.numericColumns[0]) {
    prompts.push(
      `Compare the top ${profile.categoricalColumns[0].replace(/_/g, " ")} values by ${profile.numericColumns[0].replace(/_/g, " ")} and explain the biggest drivers.`,
    );
  }

  if (trendOpportunity?.measure && trendOpportunity.dateColumn) {
    prompts.push(
      `Show the trend of ${trendOpportunity.measure.replace(/_/g, " ")} over ${trendOpportunity.dateColumn.replace(/_/g, " ")} and call out notable shifts.`,
    );
  } else if (profile.datetimeColumns[0] && profile.numericColumns[0]) {
    prompts.push(
      `Show the trend of ${profile.numericColumns[0].replace(/_/g, " ")} over ${profile.datetimeColumns[0].replace(/_/g, " ")} and call out notable shifts.`,
    );
  }

  if (distributionOpportunity?.measure) {
    prompts.push(
      `Analyze the distribution of ${distributionOpportunity.measure.replace(/_/g, " ")} and highlight skew, spread, and outliers.`,
    );
  }

  if (dataQualityOpportunity) {
    prompts.push("Show me the columns with the most missing data and explain whether they weaken the current dashboard.");
  }

  prompts.push(
    `Restructure this dashboard for a stakeholder demo with the best KPI package and one high-signal supporting view.`,
  );

  return Array.from(new Set(prompts)).slice(0, 5);
};

export const generateSuggestedPrompts = async (args: {
  profile: DatasetProfile;
  analysisMemory?: AnalysisMemory;
  existingPanels?: DashboardPanel[];
  insights?: string[];
}) => {
  const fallback = fallbackSuggestedPrompts(args.profile, args.analysisMemory, args.existingPanels);
  const parsed = await callJsonModel<{ suggestedPrompts?: string[] }>(
    env.mistralSummaryModel,
    [
      {
        role: "system",
        content:
          "You generate concise analytics follow-up prompts. Return strict JSON with a single key `suggestedPrompts`, whose value is an array of 3 to 5 short user-ready prompts. Each prompt should be specific to the dataset context, useful for the current dashboard state, and phrased as something the user can click to run. Prefer prompts that ask for a concrete next step: ranking, trend, distribution, panel explanation, chart conversion, anomaly review, or stakeholder-friendly dashboard reshapes. Avoid generic prompts like 'summarize patterns' unless they mention the actual metric or panel in view.",
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
  analysisMemory?: AnalysisMemory;
  existingPanels?: DashboardPanel[];
  prompt: string;
  contextSummary: string;
}) => {
  const fallback = inferHeuristicRoute(args.prompt, args.analysisMemory, args.existingPanels);
  const selectedRecommendation = selectRecommendationForPrompt({
    prompt: args.prompt,
    memory: args.analysisMemory,
  });

  const recommendationBiasedFallback = selectedRecommendation
    ? {
        ...fallback,
        confidence: Math.max(fallback.confidence, selectedRecommendation.score),
        summary: selectedRecommendation.reasons[0] ?? fallback.summary,
        requestClass:
          selectedRecommendation.intent === "comparison"
            ? "dashboard_refresh"
            : selectedRecommendation.intent === "ranking" && fallback.requestClass === "answer"
              ? "dashboard_refresh"
              : fallback.requestClass,
        scope:
          selectedRecommendation.requiresSandbox || fallback.requestClass === "panel_replace"
            ? fallback.scope
            : "cached_only",
      }
    : fallback;
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
        "You are the routing stage of an analytics agent. Return strict JSON with keys requestClass, scope, confidence, urgency, allowedFallbackDepth, shouldMutateDashboard, and summary. Allowed requestClass values: answer, kpi_update, panel_add, panel_replace, dashboard_refresh, diagnostic. Allowed scope values: cached_only, incremental_execution, full_rebuild. Narrative or explanatory asks should not mutate the dashboard by default. If the user asks for both KPI/summary metrics and a chart or table in the same request, prefer dashboard_refresh so the workflow can return a composed update instead of a single narrow panel.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  if (!parsed) {
    return recommendationBiasedFallback;
  }

  return {
    id: makeId("route"),
    requestClass: parsed.requestClass ?? recommendationBiasedFallback.requestClass,
    scope: parsed.scope ?? recommendationBiasedFallback.scope,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : recommendationBiasedFallback.confidence,
    urgency:
      parsed.urgency === "high" || parsed.urgency === "medium" || parsed.urgency === "low"
        ? parsed.urgency
        : recommendationBiasedFallback.urgency,
    allowedFallbackDepth:
      typeof parsed.allowedFallbackDepth === "number"
        ? Math.max(1, Math.min(7, Math.round(parsed.allowedFallbackDepth)))
        : recommendationBiasedFallback.allowedFallbackDepth,
    shouldMutateDashboard:
      typeof parsed.shouldMutateDashboard === "boolean"
        ? parsed.shouldMutateDashboard
        : recommendationBiasedFallback.shouldMutateDashboard,
    summary: parsed.summary?.trim() || recommendationBiasedFallback.summary,
  } satisfies AnalysisRoute;
};

export const createTaskSpec = async (args: {
  route: AnalysisRoute;
  profile: DatasetProfile;
  analysisMemory?: AnalysisMemory;
  existingPanels?: DashboardPanel[];
  prompt: string;
  contextSummary: string;
}) => {
  const targetPanel = extractPanelTarget(args.prompt, args.existingPanels);
  const fallback = {
    ...heuristicTaskSpec(args.route, args.prompt, args.analysisMemory),
    composition: inferCompositionPlan(args),
    targetPanel,
  };
  const parsed = await callJsonModel<Partial<TaskSpec>>(env.mistralRouterModel, [
    {
      role: "system",
      content:
        "You are the task planning stage of an analytics agent. Return strict JSON shaped like a TaskSpec with keys kind, title, businessQuestion, responseType, executionPath, acceptablePanelKinds, displayConstraints, cacheKey, validationRules, expectedOutputs, composition, targetPanel, selectedRecommendationId, and successCriteria. Do not emit final UI payloads. Do not emit Python code. Keep the task bounded and execution-safe. If the route is dashboard_refresh or the prompt asks for both summary metrics and a visual, plan for a dashboard response with concise KPIs plus one supporting panel when possible. If the prompt clearly targets an existing panel, preserve that targetPanel in the response.",
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
    composition: {
      ...fallback.composition,
      ...(parsed.composition && typeof parsed.composition === "object" ? parsed.composition : {}),
    },
    targetPanel:
      parsed.targetPanel && typeof parsed.targetPanel === "object"
        ? {
            ...fallback.targetPanel,
            ...parsed.targetPanel,
          }
        : fallback.targetPanel,
    selectedRecommendationId:
      typeof parsed.selectedRecommendationId === "string"
        ? parsed.selectedRecommendationId
        : fallback.selectedRecommendationId,
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
        "You generate Python pandas analysis code for an E2B sandbox. Return strict JSON with keys code and expectedArtifacts. The code must read /home/user/data.csv, may use pandas/numpy/json, and must write the final machine-readable JSON object to /home/user/viewpilot/query-result.json. Stdout is for lightweight human logs only, not the final result. The JSON envelope may contain keys title, narrative, kpis, panels, insights, cache, artifacts. Respect taskSpec.composition: if targetKpis > 0, return a concise KPI package; if targetPanels is 2 and supportPanelAllowed is true, try to return one strong primary panel plus one support panel only when the second panel adds genuine signal. Prefer reusable helpers from /home/user/viewpilot/analyst_helpers.py by appending /home/user/viewpilot to sys.path and importing helper functions instead of hand-rolling every chart. Every value written to JSON must already be JSON serializable: convert pandas Series/Index/ndarray to Python lists, convert numpy scalars to Python scalars, and do not place DataFrame or Series objects directly in the result. Plotly panels must use this exact shape: {\"kind\":\"plotly\",\"title\":string,\"description\":string,\"spec\":{\"data\":Array<Record<string, unknown>>,\"layout\"?:Record<string, unknown>,\"config\"?:Record<string, unknown>}}. Table panels must use {\"kind\":\"table\",\"title\":string,\"description\":string,\"columns\":string[],\"rows\":Array<Record<string, unknown>>}. Keep the task bounded and stakeholder-ready. Never return markdown fences.",
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
        "You repair Python pandas analysis code for an E2B sandbox. Return strict JSON with keys code and expectedArtifacts. Fix the failure using the stderr and validation feedback. Keep the code bounded to the original task. The repaired code must write the final machine-readable JSON object to /home/user/viewpilot/query-result.json, and stdout should only contain lightweight human logs. Respect taskSpec.composition when deciding how many KPIs and panels to return. Prefer reusable helpers from /home/user/viewpilot/analyst_helpers.py by appending /home/user/viewpilot to sys.path and importing helper functions instead of hand-rolling every chart. Every JSON value must already be JSON serializable: convert pandas Series/Index/ndarray to Python lists, convert numpy scalars to Python scalars, and never place DataFrame or Series objects directly in the result. Plotly panels must use the exact dashboard schema with kind, title, description, and spec.data/spec.layout/spec.config.",
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
  kpiLabels: string[];
  panelTitles: string[];
  narrative?: string;
}) => {
  const parsed = await callJsonModel<{ message?: string }>(env.mistralSummaryModel, [
    {
      role: "system",
      content:
        "You compose concise investor-grade analytics assistant responses. Return strict JSON with a single key `message`. The message should explain what was updated or why the dashboard was preserved, with crisp stakeholder language. Mention the real KPI labels and panel titles when available. Never invent placeholder values or fake metrics.",
    },
    {
      role: "user",
      content: JSON.stringify(args),
    },
  ]);

  const message = parsed?.message?.trim();
  if (
    message &&
    !/\bX\.XX\b|\bXX\b|\$X\.|\bplaceholder\b/i.test(message)
  ) {
    return sanitizeAssistantMessage(message);
  }

  if (args.narrative?.trim()) {
    return args.narrative.trim();
  }

  return args.mutationSummary;
};
