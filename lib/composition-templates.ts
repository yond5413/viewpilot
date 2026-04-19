import type {
  AnalysisMemory,
  AnalysisRoute,
  ChartFamily,
  CompositionTemplateKind,
} from "@/lib/types";

export type CompositionPlan = {
  template: CompositionTemplateKind;
  primaryChartFamily?: ChartFamily;
  supportPanelAllowed: boolean;
  targetKpis: number;
  targetPanels: number;
};

const chartMap: Record<CompositionTemplateKind, ChartFamily | undefined> = {
  overview: "bar",
  ranking: "bar",
  trend: "line",
  distribution: "histogram",
  data_quality: "table",
};

export const inferCompositionPlan = (args: {
  route: AnalysisRoute;
  prompt: string;
  analysisMemory?: AnalysisMemory;
}): CompositionPlan => {
  const normalizedPrompt = args.prompt.toLowerCase();
  const memory = args.analysisMemory;
  const wantsTransform = /\b(convert|change|turn|switch|replace|make)\b/.test(normalizedPrompt);
  const wantsMetrics = /\b(kpi|metric|summary|summarize|headline)\b/.test(normalizedPrompt);

  let template: CompositionTemplateKind = "overview";

  if (/\bdistribution|spread|histogram|box|outlier|variance\b/.test(normalizedPrompt)) {
    template = "distribution";
  } else if (/\btrend|timeline|over time|month|quarter|year\b/.test(normalizedPrompt)) {
    template = memory?.dateCandidates.length ? "trend" : "overview";
  } else if (/\bmissing|null|quality|coverage|dirty\b/.test(normalizedPrompt)) {
    template = "data_quality";
  } else if (/\btop|rank|largest|highest|lowest|leaders\b/.test(normalizedPrompt)) {
    template = "ranking";
  } else if (args.route.requestClass === "dashboard_refresh") {
    const opportunity = memory?.opportunities[0];
    if (opportunity?.kind === "distribution") {
      template = "distribution";
    } else if (opportunity?.kind === "time_trend") {
      template = "trend";
    } else if (opportunity?.kind === "data_quality") {
      template = "data_quality";
    } else if (opportunity?.kind === "ranking") {
      template = "ranking";
    }
  }

  if (args.route.requestClass === "kpi_update") {
    return {
      template,
      primaryChartFamily: chartMap[template],
      supportPanelAllowed: false,
      targetKpis: 4,
      targetPanels: 0,
    };
  }

  if (args.route.requestClass === "panel_replace") {
    return {
      template,
      primaryChartFamily: chartMap[template],
      supportPanelAllowed: false,
      targetKpis: wantsMetrics ? 2 : 0,
      targetPanels: 1,
    };
  }

  if (args.route.requestClass === "panel_add") {
    return {
      template,
      primaryChartFamily: chartMap[template],
      supportPanelAllowed: false,
      targetKpis: 0,
      targetPanels: 1,
    };
  }

  return {
    template,
    primaryChartFamily: chartMap[template],
    supportPanelAllowed: template === "overview" || template === "ranking",
    targetKpis: template === "data_quality" ? 2 : wantsTransform && !wantsMetrics ? 2 : 4,
    targetPanels: template === "data_quality" ? 1 : 2,
  };
};
