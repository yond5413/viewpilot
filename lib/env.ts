const readEnv = (name: string) => process.env[name]?.trim() || "";

export const env = {
  appName: readEnv("NEXT_PUBLIC_APP_NAME") || "Viewpilot",
  e2bApiKey: readEnv("E2B_API_KEY"),
  mistralApiKey: readEnv("MISTRAL_API_KEY"),
  mistralModel: readEnv("MISTRAL_MODEL") || "mistral-small-latest",
  mistralRouterModel:
    readEnv("MISTRAL_ROUTER_MODEL") ||
    readEnv("MISTRAL_MODEL") ||
    "mistral-small-latest",
  mistralCriticModel:
    readEnv("MISTRAL_CRITIC_MODEL") ||
    readEnv("MISTRAL_MODEL") ||
    "mistral-small-latest",
  mistralSummaryModel:
    readEnv("MISTRAL_SUMMARY_MODEL") ||
    readEnv("MISTRAL_MODEL") ||
    "mistral-small-latest",
  mistralCodeModel:
    readEnv("MISTRAL_CODE_MODEL") ||
    readEnv("MISTRAL_MODEL") ||
    "codestral-latest",
  mistralBaseUrl: readEnv("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1",
  mistralReasoningEffort: readEnv("MISTRAL_REASONING_EFFORT") || "",
  sandboxTimeoutMs: Number(readEnv("E2B_SANDBOX_TIMEOUT") || "3600000"),
};

export const hasLLM = Boolean(env.mistralApiKey);
export const hasE2B = Boolean(env.e2bApiKey);
