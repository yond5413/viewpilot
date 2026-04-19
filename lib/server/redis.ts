import { createClient } from "redis";
import { env } from "@/lib/env";

type ViewpilotRedisClient = ReturnType<typeof createClient>;

declare global {
  var __viewpilotRedisClient__: ViewpilotRedisClient | undefined;
  var __viewpilotRedisConnectPromise__: Promise<ViewpilotRedisClient> | undefined;
}

const createRedisClient = () => {
  if (!env.redisUrl) {
    throw new Error("REDIS_URL is not configured.");
  }

  return createClient({
    url: env.redisUrl,
  });
};

export const getRedisClient = async () => {
  if (globalThis.__viewpilotRedisClient__?.isReady) {
    return globalThis.__viewpilotRedisClient__;
  }

  if (!globalThis.__viewpilotRedisConnectPromise__) {
    const client = globalThis.__viewpilotRedisClient__ ?? createRedisClient();
    globalThis.__viewpilotRedisClient__ = client;
    globalThis.__viewpilotRedisConnectPromise__ = client.connect().then(() => client);
  }

  return globalThis.__viewpilotRedisConnectPromise__;
};
