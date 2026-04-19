import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@e2b/code-interpreter";
import { env } from "@/lib/env";
import type {
  AnalysisMemory,
  PendingClarification,
  QueryTraceSummary,
  SessionAnalysisState,
} from "@/lib/types";

const SANDBOX_DATA_PATH = "/home/user/data.csv";
const SANDBOX_SCRIPT_DIR = "/home/user/viewpilot";
const SANDBOX_SOURCE_CONFIG_PATH = `${SANDBOX_SCRIPT_DIR}/source-config.json`;
const SANDBOX_SESSION_STATE_PATH = `${SANDBOX_SCRIPT_DIR}/session-state.json`;
const SANDBOX_QUERY_RESULT_PATH = `${SANDBOX_SCRIPT_DIR}/query-result.json`;
const LOCAL_SCRIPT_DIR = path.join(process.cwd(), "sandbox-scripts");

const scriptPaths = [
  "sandbox-scripts/analyst_helpers.py",
  "sandbox-scripts/explore.py",
  "sandbox-scripts/export.py",
  "sandbox-scripts/load_source.py",
];

export const sandboxPaths = {
  data: SANDBOX_DATA_PATH,
  scriptDir: SANDBOX_SCRIPT_DIR,
  sourceConfig: SANDBOX_SOURCE_CONFIG_PATH,
  sessionState: SANDBOX_SESSION_STATE_PATH,
  queryResult: SANDBOX_QUERY_RESULT_PATH,
};

export const createSandbox = async () => {
  const sandbox = await Sandbox.create({
    apiKey: env.e2bApiKey,
    timeoutMs: env.sandboxTimeoutMs,
  });
  await seedSandboxScripts(sandbox);
  return sandbox;
};

export const connectSandbox = async (sandboxId: string) => {
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: env.e2bApiKey,
  });
  await seedSandboxScripts(sandbox);
  return sandbox;
};

export const uploadCsvToSandbox = async (
  sandbox: Sandbox,
  fileName: string,
  content: Buffer,
) => {
  const arrayBuffer = Uint8Array.from(content).buffer;

  await sandbox.files.write([
    { path: SANDBOX_DATA_PATH, data: arrayBuffer },
    { path: `${SANDBOX_SCRIPT_DIR}/source-name.txt`, data: fileName },
  ]);
};

export const runExploreScript = async (sandbox: Sandbox) => {
  const execution = await sandbox.runCode(
    await readLocalScript("sandbox-scripts/explore.py"),
    {
      language: "python",
      timeoutMs: 120_000,
    },
  );

  return execution.logs.stdout.join("");
};

export const writeSourceConfigToSandbox = async (
  sandbox: Sandbox,
  sourceConfig: unknown,
) => {
  await sandbox.files.write([
    {
      path: SANDBOX_SOURCE_CONFIG_PATH,
      data: JSON.stringify(sourceConfig, null, 2),
    },
  ]);
};

export const runLoadSourceScript = async (sandbox: Sandbox) => {
  const execution = await sandbox.runCode(
    await readLocalScript("sandbox-scripts/load_source.py"),
    {
      language: "python",
      timeoutMs: 120_000,
    },
  );

  return execution.logs.stdout.join("");
};

type RunPythonAnalysisCallbacks = {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onResult?: (result: unknown) => void;
};

const getStreamLine = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "line" in value) {
    const line = (value as { line?: unknown }).line;
    return typeof line === "string" ? line : "";
  }

  return "";
};

export const runPythonAnalysis = async (
  sandbox: Sandbox,
  code: string,
  callbacks?: RunPythonAnalysisCallbacks,
) => {
  await clearSandboxFile(sandbox, SANDBOX_QUERY_RESULT_PATH);

  const wrappedCode = `${PYTHON_ANALYSIS_PRELUDE}\n\n${code}`;

  const startTime = Date.now();
  const execution = await sandbox.runCode(wrappedCode, {
    language: "python",
    timeoutMs: 120_000,
    onStdout: (data) => callbacks?.onStdout?.(getStreamLine(data)),
    onStderr: (data) => callbacks?.onStderr?.(getStreamLine(data)),
    onResult: (result) => callbacks?.onResult?.(result),
  });

  const resultFile = await readSandboxTextFile(sandbox, SANDBOX_QUERY_RESULT_PATH);

  return {
    stdout: execution.logs.stdout.join(""),
    stderr: execution.logs.stderr.join(""),
    error: execution.error
      ? {
          name: execution.error.name,
          value: execution.error.value,
          traceback: execution.error.traceback,
        }
      : null,
    runtimeMs: Date.now() - startTime,
    resultFile,
  };
};

const PYTHON_ANALYSIS_PRELUDE = `
import json

try:
    import numpy as _np
except Exception:
    _np = None

try:
    import pandas as _pd
except Exception:
    _pd = None

if not getattr(json, "_viewpilot_patched", False):
    json._viewpilot_original_dump = json.dump
    json._viewpilot_original_dumps = json.dumps

    def _viewpilot_json_default(value):
        if _pd is not None:
            if isinstance(value, _pd.DataFrame):
                return value.to_dict(orient="records")
            if isinstance(value, _pd.Series):
                return value.to_list()
            if isinstance(value, (_pd.Timestamp, _pd.Timedelta)):
                return value.isoformat()
        if _np is not None:
            if isinstance(value, _np.ndarray):
                return value.tolist()
            if isinstance(value, _np.generic):
                return value.item()
        if hasattr(value, "item"):
            try:
                return value.item()
            except Exception:
                pass
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except Exception:
                pass
        raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")

    def _sanitize_json_value(value):
        if isinstance(value, float):
            if value != value or value == float("inf") or value == float("-inf"):
                return None
            return value
        if isinstance(value, dict):
            return {key: _sanitize_json_value(item) for key, item in value.items()}
        if isinstance(value, list):
            return [_sanitize_json_value(item) for item in value]
        if isinstance(value, tuple):
            return [_sanitize_json_value(item) for item in value]
        return value

    def _patched_json_dump(obj, fp, *args, **kwargs):
        kwargs.setdefault("default", _viewpilot_json_default)
        kwargs.setdefault("allow_nan", False)
        return json._viewpilot_original_dump(_sanitize_json_value(obj), fp, *args, **kwargs)

    def _patched_json_dumps(obj, *args, **kwargs):
        kwargs.setdefault("default", _viewpilot_json_default)
        kwargs.setdefault("allow_nan", False)
        return json._viewpilot_original_dumps(_sanitize_json_value(obj), *args, **kwargs)

    json.dump = _patched_json_dump
    json.dumps = _patched_json_dumps
    json._viewpilot_patched = True
`.trim();

export const loadSessionAnalysisStateFromSandbox = async (
  sandbox: Sandbox,
): Promise<SessionAnalysisState | null> => {
  const payload = await readSandboxTextFile(sandbox, SANDBOX_SESSION_STATE_PATH);
  if (!payload?.trim()) {
    return null;
  }

  try {
    return coerceSessionAnalysisState(JSON.parse(payload));
  } catch {
    return null;
  }
};

export const writeSessionAnalysisStateToSandbox = async (
  sandbox: Sandbox,
  state: SessionAnalysisState,
) => {
  await sandbox.files.write([
    {
      path: SANDBOX_SESSION_STATE_PATH,
      data: JSON.stringify(state, null, 2),
    },
  ]);
};

const clearSandboxFile = async (sandbox: Sandbox, filePath: string) => {
  await sandbox.runCode(
    `
from pathlib import Path

path = Path(${JSON.stringify(filePath)})
if path.exists():
    path.unlink()
    `.trim(),
    {
      language: "python",
      timeoutMs: 15_000,
    },
  );
};

const readSandboxTextFile = async (sandbox: Sandbox, filePath: string) => {
  const execution = await sandbox.runCode(
    `
from pathlib import Path
import json

path = Path(${JSON.stringify(filePath)})
payload = {
    "exists": path.exists(),
    "content": path.read_text() if path.exists() else None,
}
print("SANDBOX_FILE_JSON:" + json.dumps(payload))
    `.trim(),
    {
      language: "python",
      timeoutMs: 15_000,
    },
  );

  const payloadLine = execution.logs.stdout
    .join("")
    .split("\n")
    .find((line) => line.startsWith("SANDBOX_FILE_JSON:"));

  if (!payloadLine) {
    return null;
  }

  const payload = JSON.parse(payloadLine.replace("SANDBOX_FILE_JSON:", "")) as {
    exists?: boolean;
    content?: string | null;
  };

  return payload.exists ? payload.content ?? null : null;
};

const coerceSessionAnalysisState = (value: unknown): SessionAnalysisState | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const observability = coerceObservability(candidate.observability);
  if (!observability) {
    return null;
  }

  return {
    datasetFingerprint:
      typeof candidate.datasetFingerprint === "string" ? candidate.datasetFingerprint : undefined,
    profile:
      candidate.profile && typeof candidate.profile === "object"
        ? (candidate.profile as SessionAnalysisState["profile"])
        : undefined,
    analysisMemory: coerceAnalysisMemory(candidate.analysisMemory),
    validatedMetrics: Array.isArray(candidate.validatedMetrics)
      ? (candidate.validatedMetrics as SessionAnalysisState["validatedMetrics"])
      : [],
    validatedPanels: Array.isArray(candidate.validatedPanels)
      ? (candidate.validatedPanels as SessionAnalysisState["validatedPanels"])
      : [],
    cachedResults:
      candidate.cachedResults && typeof candidate.cachedResults === "object"
        ? (candidate.cachedResults as Record<string, unknown>)
        : {},
    taskHistory: Array.isArray(candidate.taskHistory)
      ? (candidate.taskHistory as SessionAnalysisState["taskHistory"])
      : [],
    failedPatterns: Array.isArray(candidate.failedPatterns)
      ? candidate.failedPatterns.filter((item): item is string => typeof item === "string")
      : [],
    artifacts: Array.isArray(candidate.artifacts)
      ? candidate.artifacts.filter((item): item is string => typeof item === "string")
      : [],
    currentDashboardVersion:
      typeof candidate.currentDashboardVersion === "number" &&
      Number.isFinite(candidate.currentDashboardVersion)
        ? candidate.currentDashboardVersion
        : 0,
    observability,
    lastQueryTraceSummary: coerceTraceSummary(candidate.lastQueryTraceSummary),
    pendingClarification: coercePendingClarification(candidate.pendingClarification),
  } satisfies SessionAnalysisState;
};

const coerceObservability = (value: unknown): SessionAnalysisState["observability"] | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const numberOrZero = (key: string) => {
    const next = candidate[key];
    return typeof next === "number" && Number.isFinite(next) ? next : 0;
  };

  return {
    requestCount: numberOrZero("requestCount"),
    cacheHitCount: numberOrZero("cacheHitCount"),
    executionCount: numberOrZero("executionCount"),
    executionFailureCount: numberOrZero("executionFailureCount"),
    validationRejectCount: numberOrZero("validationRejectCount"),
    criticRejectCount: numberOrZero("criticRejectCount"),
    fallbackCount: numberOrZero("fallbackCount"),
    panelReplacementCount: numberOrZero("panelReplacementCount"),
    totalRuntimeMs: numberOrZero("totalRuntimeMs"),
  };
};

const coerceTraceSummary = (value: unknown): QueryTraceSummary | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.traceId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.finalStatus !== "string" ||
    typeof candidate.stageCount !== "number"
  ) {
    return undefined;
  }

  return {
    traceId: candidate.traceId,
    createdAt: candidate.createdAt,
    finalStatus:
      candidate.finalStatus === "success" ||
      candidate.finalStatus === "fallback" ||
      candidate.finalStatus === "error"
        ? candidate.finalStatus
        : "error",
    failedStage: typeof candidate.failedStage === "string" ? candidate.failedStage as QueryTraceSummary["failedStage"] : undefined,
    errorCode: typeof candidate.errorCode === "string" ? candidate.errorCode as QueryTraceSummary["errorCode"] : undefined,
    errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : undefined,
    stageCount: candidate.stageCount,
  };
};

const coercePendingClarification = (value: unknown): PendingClarification | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.originalPrompt !== "string" ||
    typeof candidate.reason !== "string" ||
    !Array.isArray(candidate.options)
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    traceId: typeof candidate.traceId === "string" ? candidate.traceId : undefined,
    originalPrompt: candidate.originalPrompt,
    reason: candidate.reason,
    recommendedOptionId:
      typeof candidate.recommendedOptionId === "string" ? candidate.recommendedOptionId : undefined,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    options: candidate.options
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        label: typeof item.label === "string" ? item.label : "",
        description: typeof item.description === "string" ? item.description : "",
        resolvedPrompt: typeof item.resolvedPrompt === "string" ? item.resolvedPrompt : "",
      }))
      .filter((item) => item.id && item.label),
  };
};

const coerceAnalysisMemory = (value: unknown): AnalysisMemory | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  return {
    columns: Array.isArray(candidate.columns)
      ? (candidate.columns as AnalysisMemory["columns"])
      : [],
    primaryDimensions: Array.isArray(candidate.primaryDimensions)
      ? candidate.primaryDimensions.filter((item): item is string => typeof item === "string")
      : [],
    primaryMeasures: Array.isArray(candidate.primaryMeasures)
      ? candidate.primaryMeasures.filter((item): item is string => typeof item === "string")
      : [],
    dateCandidates: Array.isArray(candidate.dateCandidates)
      ? candidate.dateCandidates.filter((item): item is string => typeof item === "string")
      : [],
    dataQualityWarnings: Array.isArray(candidate.dataQualityWarnings)
      ? candidate.dataQualityWarnings.filter((item): item is string => typeof item === "string")
      : [],
    opportunities: Array.isArray(candidate.opportunities)
      ? (candidate.opportunities as AnalysisMemory["opportunities"])
      : [],
    recommendations: Array.isArray(candidate.recommendations)
      ? (candidate.recommendations as AnalysisMemory["recommendations"])
      : [],
    metricHighlights: Array.isArray(candidate.metricHighlights)
      ? (candidate.metricHighlights as AnalysisMemory["metricHighlights"])
      : [],
  };
};

const seedSandboxScripts = async (sandbox: Sandbox) => {
  const files = await Promise.all(
    scriptPaths.map(async (scriptPath) => ({
      path: `${SANDBOX_SCRIPT_DIR}/${path.basename(scriptPath)}`,
      data: await readLocalScript(scriptPath),
    })),
  );

  await sandbox.files.write(files);
};

const readLocalScript = async (relativePath: string) => {
  const absolutePath = path.join(
    LOCAL_SCRIPT_DIR,
    path.basename(relativePath),
  );
  return readFile(absolutePath, "utf8");
};
