import { z } from "zod";
import { TypeSafeJudge } from "./typesafe";
import type { Judge } from "./types";

const EnvSchema = z.object({
  JUDGE_PROVIDER: z.enum(["typesafe", "none"]).default("typesafe"),
  TYPESAFE_API_KEY: z.string().optional(),
  TYPESAFE_MODEL: z.string().min(1).default("jev-latest"),
  TYPESAFE_BASE_URL: z.url().default("https://api.typesafe.ai"),
  JUDGE_DAILY_TOKEN_CAP: z.coerce.number().int().min(0).default(400_000),
  TYPESAFE_PRICE_PER_MTOK: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().optional()),
});

export type AiConfig = z.infer<typeof EnvSchema>;

/** Parse AI settings from the environment. Throws a readable error naming the bad variable. */
export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const cleaned = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`AI configuration is invalid: ${issues}`);
  }
  return parsed.data;
}

export interface JudgeSetup {
  judge: Judge | null;
  /** Why no judge is available, when judge is null. */
  reason?: string;
  config: AiConfig;
}

/** Build the configured judge, or explain why there is none. */
export function createJudgeFromEnv(env: Record<string, string | undefined> = process.env): JudgeSetup {
  const config = loadAiConfig(env);
  if (config.JUDGE_PROVIDER === "none") {
    return { judge: null, reason: "JUDGE_PROVIDER=none", config };
  }
  if (!config.TYPESAFE_API_KEY) {
    return { judge: null, reason: "TYPESAFE_API_KEY is not set", config };
  }
  return {
    judge: new TypeSafeJudge({
      apiKey: config.TYPESAFE_API_KEY,
      model: config.TYPESAFE_MODEL,
      baseUrl: config.TYPESAFE_BASE_URL,
    }),
    config,
  };
}

/** A description of the active AI setup that is safe to show on a settings page (no secrets). */
export function describeAiSetup(env: Record<string, string | undefined> = process.env) {
  const { judge, reason, config } = createJudgeFromEnv(env);
  return {
    judgments: judge
      ? { provider: judge.provider, model: judge.model, baseUrl: config.TYPESAFE_BASE_URL, active: true }
      : { provider: config.JUDGE_PROVIDER, model: config.TYPESAFE_MODEL, active: false, reason },
    dailyTokenCap: config.JUDGE_DAILY_TOKEN_CAP,
    pricePerMTok: config.TYPESAFE_PRICE_PER_MTOK ?? null,
    chat: { active: false, reason: "The ask feature is not built yet." },
  };
}
