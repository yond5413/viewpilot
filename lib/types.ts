export type DataFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "unknown";

export type ChartPanel = {
  id: string;
  kind: "plotly";
  title: string;
  description: string;
  insight?: string;
  spec: {
    data: Record<string, unknown>[];
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
};

export type TablePanel = {
  id: string;
  kind: "table";
  title: string;
  description: string;
  insight?: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

export type HtmlPanel = {
  id: string;
  kind: "html";
  title: string;
  description: string;
  insight?: string;
  html: string;
};

export type DashboardPanel = ChartPanel | TablePanel | HtmlPanel;

export type KPI = {
  id: string;
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "positive" | "warning";
};

export type DatasetProfile = {
  filename: string;
  rows: number;
  columns: number;
  numericColumns: string[];
  categoricalColumns: string[];
  datetimeColumns: string[];
  booleanColumns: string[];
  columnsByType: Array<{
    name: string;
    inferredType: DataFieldType;
    nullRate: number;
  }>;
  sampleRows: Array<Record<string, string | number | boolean | null>>;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  code?: string;
  panelId?: string;
  createdAt: string;
};

export type DashboardState = {
  sessionId: string;
  sandboxId: string;
  status: string;
  filename?: string;
  profile?: DatasetProfile;
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
  messages: AgentMessage[];
  exportReady: boolean;
  lastUpdatedAt: string;
};

export type QueryPlan = {
  title: string;
  responseType: "chart" | "table" | "html" | "text";
  assistantMessage: string;
  analysisCode: string;
  insight: string;
};
