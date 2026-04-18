import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@e2b/code-interpreter";
import { env } from "@/lib/env";
import type { SessionAnalysisState } from "@/lib/types";

const SANDBOX_DATA_PATH = "/home/user/data.csv";
const SANDBOX_SCRIPT_DIR = "/home/user/viewpilot";
const SANDBOX_SOURCE_CONFIG_PATH = `${SANDBOX_SCRIPT_DIR}/source-config.json`;
const SANDBOX_SESSION_STATE_PATH = `${SANDBOX_SCRIPT_DIR}/session-state.json`;
const LOCAL_SCRIPT_DIR = path.join(process.cwd(), "sandbox-scripts");

const scriptPaths = [
  "sandbox-scripts/explore.py",
  "sandbox-scripts/export.py",
  "sandbox-scripts/load_source.py",
];

export const sandboxPaths = {
  data: SANDBOX_DATA_PATH,
  scriptDir: SANDBOX_SCRIPT_DIR,
  sourceConfig: SANDBOX_SOURCE_CONFIG_PATH,
  sessionState: SANDBOX_SESSION_STATE_PATH,
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

export const runPythonAnalysis = async (sandbox: Sandbox, code: string) => {
  const startTime = Date.now();
  const execution = await sandbox.runCode(code, {
    language: "python",
    timeoutMs: 120_000,
  });

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
  };
};

export const loadSessionAnalysisStateFromSandbox = async (
  sandbox: Sandbox,
): Promise<SessionAnalysisState | null> => {
  const execution = await runPythonAnalysis(
    sandbox,
    `
from pathlib import Path

path = Path("${SANDBOX_SESSION_STATE_PATH}")
if path.exists():
    print("SESSION_STATE_JSON:" + path.read_text())
else:
    print("SESSION_STATE_JSON:null")
    `.trim(),
  );

  const sessionLine = execution.stdout
    .split("\n")
    .find((line) => line.startsWith("SESSION_STATE_JSON:"));

  if (!sessionLine) {
    return null;
  }

  const payload = sessionLine.replace("SESSION_STATE_JSON:", "").trim();
  if (!payload || payload === "null") {
    return null;
  }

  return JSON.parse(payload) as SessionAnalysisState;
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
