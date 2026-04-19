import type {
  AnalysisMemory,
  ChartRecommendation,
  DashboardPanel,
  PanelTarget,
} from "@/lib/types";

const buildRecommendation = (args: Omit<ChartRecommendation, "id"> & { id: string }) => args;

export const buildRecommendationsFromMemory = (memory?: AnalysisMemory) => {
  if (!memory) {
    return [] as ChartRecommendation[];
  }

  const recommendations: ChartRecommendation[] = [];
  const primaryDimension = memory.primaryDimensions[0];
  const primaryMeasure = memory.primaryMeasures[0];
  const compareMeasures = memory.primaryMeasures.slice(0, 2);
  const dateColumn = memory.dateCandidates[0];

  if (primaryDimension && primaryMeasure) {
    recommendations.push(
      buildRecommendation({
        id: `ranking:${primaryDimension}:${primaryMeasure}`,
        intent: "ranking",
        mark: "bar",
        score: 0.92,
        reasons: [`${primaryDimension} is the strongest grouping field for ${primaryMeasure}.`],
        warnings: [],
        requiresSandbox: true,
        fields: { dimension: primaryDimension, measure: primaryMeasure },
        transform: { aggregate: "sum", topN: 10, sort: "desc" },
      }),
    );

    recommendations.push(
      buildRecommendation({
        id: `composition:${primaryDimension}:${primaryMeasure}`,
        intent: "composition",
        mark: "pie",
        score: 0.72,
        reasons: [`${primaryDimension} can support a share-of-total view for ${primaryMeasure}.`],
        warnings: ["Use only when the grouped values represent part-to-whole clearly."],
        requiresSandbox: true,
        fields: { dimension: primaryDimension, measure: primaryMeasure },
        transform: { aggregate: "sum", topN: 6, sort: "desc" },
      }),
    );
  }

  if (dateColumn && primaryMeasure) {
    recommendations.push(
      buildRecommendation({
        id: `trend:${dateColumn}:${primaryMeasure}`,
        intent: "trend",
        mark: "line",
        score: 0.9,
        reasons: [`${dateColumn} is a viable time axis for ${primaryMeasure}.`],
        warnings: [],
        requiresSandbox: true,
        fields: { dateColumn, measure: primaryMeasure },
        transform: { aggregate: "sum" },
      }),
    );
  }

  if (primaryMeasure) {
    recommendations.push(
      buildRecommendation({
        id: `distribution:${primaryMeasure}`,
        intent: "distribution",
        mark: "histogram",
        score: 0.84,
        reasons: [`${primaryMeasure} is the strongest quantitative field for distribution analysis.`],
        warnings: [],
        requiresSandbox: true,
        fields: { measure: primaryMeasure },
        transform: { binning: true },
      }),
    );

    recommendations.push(
      buildRecommendation({
        id: `box:${primaryMeasure}`,
        intent: "distribution",
        mark: "box",
        score: 0.82,
        reasons: [`${primaryMeasure} can support a box plot for spread and outliers.`],
        warnings: [],
        requiresSandbox: false,
        fields: { measure: primaryMeasure },
        transform: {},
      }),
    );
  }

  if (compareMeasures.length === 2 && primaryDimension) {
    recommendations.push(
      buildRecommendation({
        id: `comparison:${primaryDimension}:${compareMeasures.join(",")}`,
        intent: "comparison",
        mark: "bar",
        score: 0.88,
        reasons: [`${compareMeasures.join(" and ")} can be compared across ${primaryDimension}.`],
        warnings: [],
        requiresSandbox: true,
        fields: { dimension: primaryDimension, compareMeasures },
        transform: { aggregate: "sum", topN: 5, sort: "desc" },
      }),
    );
  }

  if (memory.dataQualityWarnings.length > 0) {
    recommendations.push(
      buildRecommendation({
        id: "data-quality:watchlist",
        intent: "data_quality",
        mark: "table",
        score: 0.8,
        reasons: [memory.dataQualityWarnings[0]],
        warnings: [],
        requiresSandbox: false,
        fields: {},
        transform: {},
      }),
    );
  }

  return recommendations.sort((a, b) => b.score - a.score);
};

export const selectRecommendationForPrompt = (args: {
  prompt: string;
  memory?: AnalysisMemory;
}) => {
  const normalized = args.prompt.toLowerCase();
  const recommendations = args.memory?.recommendations ?? buildRecommendationsFromMemory(args.memory);

  const rank = recommendations.find((item) => item.intent === "ranking");
  const comparison = recommendations.find((item) => item.intent === "comparison");
  const distribution = recommendations.find((item) => item.mark === "histogram");
  const box = recommendations.find((item) => item.mark === "box");
  const trend = recommendations.find((item) => item.intent === "trend");
  const composition = recommendations.find((item) => item.intent === "composition");

  if (/\bcompare|vs\b/.test(normalized) && comparison) return comparison;
  if ((/\bbox plot|boxplot\b/.test(normalized) || /\boutlier\b/.test(normalized)) && box) return box;
  if (/\bhistogram|distribution|spread\b/.test(normalized) && distribution) return distribution;
  if (/\bpie|donut|share\b/.test(normalized) && composition) return composition;
  if (/\btrend|timeline|over time\b/.test(normalized) && trend) return trend;
  if (/\brank|top|largest|highest|lowest\b/.test(normalized) && rank) return rank;

  return recommendations[0];
};

export const shouldUseSandbox = (args: {
  prompt: string;
  routeClass: string;
  recommendation?: ChartRecommendation;
  targetPanel?: PanelTarget;
}) => {
  if (args.routeClass === "diagnostic" || args.routeClass === "answer") {
    return false;
  }

  if (args.routeClass === "panel_replace" && args.targetPanel && args.recommendation && !args.recommendation.requiresSandbox) {
    return false;
  }

  return args.recommendation?.requiresSandbox ?? true;
};

export const inferLocalTransformFromRecommendation = (args: {
  recommendation?: ChartRecommendation;
  targetPanel?: DashboardPanel;
}) => {
  if (!args.recommendation || !args.targetPanel || args.targetPanel.kind !== "plotly") {
    return null;
  }

  if (args.recommendation.mark === "box") {
    return "box" as const;
  }

  if (args.recommendation.mark === "pie") {
    return "pie" as const;
  }

  if (args.recommendation.mark === "table") {
    return "table" as const;
  }

  return null;
};
