import OpenAI from "openai";
import { env, hasLLM } from "@/lib/env";
import type {
  DashboardPanel,
  DatasetProfile,
  KPI,
  QueryPlan,
} from "@/lib/types";
import { makeId } from "@/lib/utils";

const llmClient = hasLLM
  ? new OpenAI({
      apiKey: env.mistralApiKey,
      baseURL: env.mistralBaseUrl,
    })
  : null;

export const parseExplorePayload = (raw: string) => {
  const profileLine = raw
    .split("\n")
    .find((line) => line.startsWith("EXPLORE_JSON:"));

  if (!profileLine) {
    throw new Error("Explore script did not return EXPLORE_JSON payload.");
  }

  return JSON.parse(profileLine.replace("EXPLORE_JSON:", ""));
};

export const buildInitialDashboard = (payload: {
  profile: DatasetProfile;
  kpis: KPI[];
  panels: DashboardPanel[];
  insights: string[];
}) => payload;

export const planQuery = async (args: {
  profile: DatasetProfile;
  prompt: string;
}) => {
  if (!llmClient) {
    return null;
  }

  const response = await llmClient.chat.completions.create({
    model: env.mistralModel,
    response_format: {
      type: "json_object",
    },
    messages: [
      {
        role: "system",
        content:
          "You are an analytics copilot. Given a dataset profile and a user question, return strict JSON with keys title, responseType, assistantMessage, analysisCode, and insight. analysisCode must be valid Python, must read /home/user/data.csv with pandas, and must print exactly one line prefixed RESULT_JSON: followed by a JSON object. Allowed responseType values are chart, table, html, text.",
      },
      {
        role: "user",
        content: JSON.stringify(args),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  const normalizedContent =
    typeof content === "string" ? content : JSON.stringify(content ?? {});
  if (!normalizedContent) {
    throw new Error("Mistral did not return a query plan.");
  }
  const parsed = JSON.parse(normalizedContent) as QueryPlan;
  return parsed;
};

export const generateHtmlPanel = async (args: {
  title: string;
  prompt: string;
  result: unknown;
}) => {
  if (!llmClient) {
    return null;
  }

  const response = await llmClient.chat.completions.create({
    model: env.mistralModel,
    messages: [
      {
        role: "system",
        content:
          "Return only a polished HTML fragment for a compact analytics card. No markdown fences, no scripts, and no external dependencies. Use semantic HTML with inline styles only. The fragment should look premium and readable in a light analytics dashboard.",
      },
      {
        role: "user",
        content: JSON.stringify(args),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  const html = typeof content === "string" ? content.trim() : "";
  if (!html) {
    throw new Error("Mistral did not return a custom component.");
  }

  return {
    id: makeId("panel"),
    kind: "html" as const,
    title: args.title,
    description: "Generated custom analysis component",
    insight: args.prompt,
    html,
  };
};
