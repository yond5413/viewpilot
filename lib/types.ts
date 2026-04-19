export type DataFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "unknown";

export type SemanticRole =
  | "dimension"
  | "measure"
  | "datetime"
  | "identifier"
  | "label"
  | "text"
  | "boolean";

export type ChartFamily =
  | "bar"
  | "line"
  | "area"
  | "scatter"
  | "histogram"
  | "box"
  | "pie"
  | "table";

export type AnalysisOpportunityKind =
  | "overview"
  | "ranking"
  | "comparison"
  | "distribution"
  | "time_trend"
  | "breakdown"
  | "data_quality"
  | "composition";

export type RecommendationIntent =
  | "ranking"
  | "comparison"
  | "distribution"
  | "composition"
  | "trend"
  | "correlation"
  | "table"
  | "data_quality";

export type CompositionTemplateKind =
  | "overview"
  | "ranking"
  | "trend"
  | "distribution"
  | "data_quality";

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

export type QueryStage =
  | "request_intake"
  | "session_context"
  | "route"
  | "task_spec"
  | "codegen"
  | "sandbox_execution"
  | "sandbox_result_parse"
  | "validation"
  | "critic"
  | "mutation"
  | "persist";

export type StageErrorCode =
  | "REQUEST_INVALID"
  | "SESSION_NOT_READY"
  | "SESSION_STATE_INVALID"
  | "ROUTE_JSON_INVALID"
  | "TASK_SPEC_JSON_INVALID"
  | "CODEGEN_JSON_INVALID"
  | "SANDBOX_EXECUTION_FAILED"
  | "SANDBOX_RESULT_MISSING"
  | "SANDBOX_RESULT_INVALID_JSON"
  | "VALIDATION_REJECTED"
  | "CRITIC_REJECTED"
  | "PERSIST_FAILED";

export type StageError = {
  code: StageErrorCode;
  message: string;
  rawPreview?: string;
};

export type StageResult<T> = {
  stage: QueryStage;
  ok: boolean;
  data?: T;
  error?: StageError;
  debug: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
};

export type QueryTraceEvent = {
  stage: QueryStage;
  ok: boolean;
  summary: string;
  durationMs: number;
  rawPreview?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type QueryTrace = {
  traceId: string;
  sessionId: string;
  prompt: string;
  createdAt: string;
  events: QueryTraceEvent[];
  finalStatus: "success" | "fallback" | "error";
  failedStage?: QueryStage;
};

export type QueryTraceSummary = {
  traceId: string;
  createdAt: string;
  finalStatus: QueryTrace["finalStatus"];
  failedStage?: QueryStage;
  errorCode?: StageErrorCode;
  errorMessage?: string;
  stageCount: number;
};

export type AnalysisStreamEvent = {
  id: string;
  sessionId: string;
  traceId?: string;
  ts: string;
  type:
    | "stage_started"
    | "stage_progress"
    | "stage_warning"
    | "stage_result"
    | "stage_failed"
    | "analysis_complete";
  stage?: QueryStage | "stream";
  message: string;
  payload?: Record<string, string | number | boolean | null>;
};

export type PanelTarget = {
  index?: number;
  title?: string;
  matchType: "ordinal" | "title" | "implicit";
  confidence: number;
};

export type ConfidenceBreakdown = {
  intentConfidence: number;
  dataConfidence: number;
  outputConfidence: number;
  finalConfidence: number;
  reasons: string[];
};

export type ClarificationOption = {
  id: string;
  label: string;
  description: string;
  resolvedPrompt: string;
};

export type PendingClarification = {
  id: string;
  traceId?: string;
  originalPrompt: string;
  reason: string;
  options: ClarificationOption[];
  recommendedOptionId?: string;
  createdAt: string;
};

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
  recommendationId?: string;
  sourceFields?: string[];
  localTransformableTo?: ChartFamily[];
  transformSummary?: string;
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

export type ColumnAnalysisMemory = {
  name: string;
  inferredType: DataFieldType;
  semanticRole: SemanticRole;
  nullRate: number;
  distinctCount: number;
  uniquenessRatio: number;
  topValues: Array<{
    value: string;
    count: number;
  }>;
  numericSummary?: {
    min: number;
    max: number;
    mean: number;
    median: number;
    std: number;
  };
  isRecommendedDimension: boolean;
  isRecommendedMeasure: boolean;
};

export type AnalysisOpportunity = {
  id: string;
  kind: AnalysisOpportunityKind;
  title: string;
  chartFamily: ChartFamily;
  confidence: number;
  rationale: string;
  dimension?: string;
  measure?: string;
  dateColumn?: string;
};

export type ChartRecommendation = {
  id: string;
  intent: RecommendationIntent;
  mark: ChartFamily;
  score: number;
  reasons: string[];
  warnings: string[];
  requiresSandbox: boolean;
  fields: {
    dimension?: string;
    measure?: string;
    dateColumn?: string;
    compareMeasures?: string[];
  };
  transform: {
    aggregate?: "sum" | "mean" | "count";
    topN?: number;
    sort?: "asc" | "desc";
    binning?: boolean;
  };
};

export type AnalysisMemory = {
  columns: ColumnAnalysisMemory[];
  primaryDimensions: string[];
  primaryMeasures: string[];
  dateCandidates: string[];
  dataQualityWarnings: string[];
  opportunities: AnalysisOpportunity[];
  recommendations?: ChartRecommendation[];
  metricHighlights?: Array<{
    label: string;
    value: string;
    tone?: "neutral" | "positive" | "warning";
  }>;
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
  targetPanel?: PanelTarget;
  selectedRecommendationId?: string;
  composition: {
    template: CompositionTemplateKind;
    primaryChartFamily?: ChartFamily;
    supportPanelAllowed: boolean;
    targetKpis: number;
    targetPanels: number;
  };
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
  stdout: string;
  stderr: string;
  errorMessage?: string;
  artifactPaths: string[];
  runtimeMs: number;
  cacheCandidates: Record<string, unknown>;
  resultRaw?: string;
  resultSource: "file" | "stdout" | "none";
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
  pendingClarification?: PendingClarification;
};

export type TaskHistoryEntry = {
  id: string;
  queryTraceId?: string;
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
  confidence?: ConfidenceBreakdown;
  clarificationTriggered?: boolean;
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
  analysisMemory?: AnalysisMemory;
  validatedMetrics: KPI[];
  validatedPanels: DashboardPanel[];
  cachedResults: Record<string, unknown>;
  taskHistory: TaskHistoryEntry[];
  failedPatterns: string[];
  artifacts: string[];
  currentDashboardVersion: number;
  observability: SessionObservability;
  lastQueryTraceSummary?: QueryTraceSummary;
  pendingClarification?: PendingClarification;
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
