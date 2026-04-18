export type DataFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "unknown";

export type RequestClass =
  | "answer"
  | "kpi_update"
  | "panel_add"
  | "panel_replace"
  | "dashboard_refresh"
  | "diagnostic";

export type AnalysisScope =
  | "cached_only"
  | "incremental_execution"
  | "full_rebuild";

export type ExecutionPath =
  | "use_cache"
  | "run_python"
  | "repair_python"
  | "downgrade_scope"
  | "narrative_only";

export type TaskKind =
  | "metric"
  | "table"
  | "chart"
  | "narrative"
  | "dashboard_composition";

export type CriticStatus =
  | "approve"
  | "approve_with_trim"
  | "retry_with_restrictions"
  | "downgrade"
  | "reject";

export type ValidationStatus = "approved" | "trimmed" | "rejected";

export type DashboardMutationType =
  | "none"
  | "kpi_update"
  | "panel_add"
  | "panel_replace"
  | "dashboard_refresh";

export type FallbackStrategy =
  | "validated_full_dashboard_update"
  | "validated_partial_dashboard_update"
  | "validated_single_panel"
  | "validated_kpi_refresh"
  | "cached_answer"
  | "narrative_only"
  | "transparent_failure";

export type PanelProvenance = {
  sourceTaskId: string;
  cacheKey?: string;
  generatedByModel?: string;
  validatedAt?: string;
  routeClass?: RequestClass;
  mutationType?: DashboardMutationType;
  artifactPaths?: string[];
};

export type ChartPanel = {
  id: string;
  kind: "plotly";
  title: string;
  description: string;
  insight?: string;
  provenance?: PanelProvenance;
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
  provenance?: PanelProvenance;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

export type HtmlPanel = {
  id: string;
  kind: "html";
  title: string;
  description: string;
  insight?: string;
  provenance?: PanelProvenance;
  html: string;
};

export type DashboardPanel = ChartPanel | TablePanel | HtmlPanel;

export type KPI = {
  id: string;
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "positive" | "warning";
  provenance?: PanelProvenance;
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

export type AnalysisRoute = {
  id: string;
  requestClass: RequestClass;
  scope: AnalysisScope;
  confidence: number;
  urgency: "low" | "medium" | "high";
  allowedFallbackDepth: number;
  shouldMutateDashboard: boolean;
  summary: string;
};

export type TaskSpec = {
  id: string;
  kind: TaskKind;
  title: string;
  userPrompt: string;
  businessQuestion: string;
  responseType: "chart" | "table" | "html" | "text" | "dashboard";
  executionPath: ExecutionPath;
  acceptablePanelKinds: Array<DashboardPanel["kind"]>;
  displayConstraints: {
    maxKpis: number;
    maxPanels: number;
    maxRows: number;
    maxLabelLength: number;
    maxValueLength: number;
    investorMode: boolean;
  };
  cacheKey: string;
  validationRules: string[];
  expectedOutputs: {
    narrative: boolean;
    kpis: boolean;
    panels: boolean;
  };
  routeClass: RequestClass;
  scope: AnalysisScope;
  successCriteria: string[];
};

export type AnalysisCandidate = {
  title?: string;
  narrative?: string;
  kpis?: KPI[];
  panels?: DashboardPanel[];
  insights?: string[];
  cache?: Record<string, unknown>;
  artifacts?: string[];
};

export type ExecutionEnvelope = {
  status: "success" | "error";
  code: string;
  model: string;
  result?: AnalysisCandidate;
  stdout: string;
  stderr: string;
  errorMessage?: string;
  artifactPaths: string[];
  runtimeMs: number;
  cacheCandidates: Record<string, unknown>;
};

export type ValidationResult = {
  status: ValidationStatus;
  reasons: string[];
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
  narrative?: string;
  confidence: number;
};

export type CriticDecision = {
  status: CriticStatus;
  reasons: string[];
  suggestedRestrictions: string[];
};

export type FallbackDecision = {
  strategy: FallbackStrategy;
  reason: string;
};

export type DashboardMutation = {
  mutationType: DashboardMutationType;
  assistantMessage: string;
  narrative?: string;
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
  preservedExisting: boolean;
};

export type TaskHistoryEntry = {
  id: string;
  prompt: string;
  createdAt: string;
  route: AnalysisRoute;
  taskSpec?: TaskSpec;
  executionPath: ExecutionPath;
  model: string;
  code?: string;
  executionStatus: "not_run" | "success" | "error";
  validationResult?: ValidationResult;
  criticDecision?: CriticDecision;
  fallbackDecision?: FallbackDecision;
  finalMutationType: DashboardMutationType;
  cacheKey?: string;
  artifactPaths: string[];
  errorMessage?: string;
};

export type SessionObservability = {
  requestCount: number;
  cacheHitCount: number;
  executionCount: number;
  executionFailureCount: number;
  validationRejectCount: number;
  criticRejectCount: number;
  fallbackCount: number;
  panelReplacementCount: number;
  totalRuntimeMs: number;
};

export type SessionAnalysisState = {
  datasetFingerprint?: string;
  profile?: DatasetProfile;
  validatedMetrics: KPI[];
  validatedPanels: DashboardPanel[];
  cachedResults: Record<string, unknown>;
  taskHistory: TaskHistoryEntry[];
  failedPatterns: string[];
  artifacts: string[];
  currentDashboardVersion: number;
  observability: SessionObservability;
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
  suggestedPrompts: string[];
  messages: AgentMessage[];
  analysisState: SessionAnalysisState;
  exportReady: boolean;
  lastUpdatedAt: string;
};
