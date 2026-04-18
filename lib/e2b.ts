import { readFile } from "node:fs/promises";
import path from "node:path";
import { Sandbox } from "@e2b/code-interpreter";
import { env } from "@/lib/env";

const SANDBOX_DATA_PATH = "/home/user/data.csv";
const SANDBOX_SCRIPT_DIR = "/home/user/viewpilot";
const LOCAL_SCRIPT_DIR = path.join(process.cwd(), "sandbox-scripts");

const scriptPaths = [
  "sandbox-scripts/explore.py",
  "sandbox-scripts/export.py",
];

export const sandboxPaths = {
  data: SANDBOX_DATA_PATH,
  scriptDir: SANDBOX_SCRIPT_DIR,
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

export const runPythonAnalysis = async (sandbox: Sandbox, code: string) => {
  const execution = await sandbox.runCode(code, {
    language: "python",
    timeoutMs: 120_000,
  });

  return execution.logs.stdout.join("");
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
