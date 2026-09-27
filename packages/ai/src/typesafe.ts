import type { Answer, Judge, JudgeRequest, JudgeResult, Question } from "./types";

export interface TypeSafeOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Retries for 429, 529 and 5xx responses. */
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class JudgeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JudgeError";
  }
}

interface WireResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

/**
 * Thin client for TypeSafe's System One HTTP API (POST /v1/systemone).
 * Written against the documented wire format rather than the SDK so the request shape is explicit.
 */
export class TypeSafeJudge implements Judge {
  readonly provider = "typesafe";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: TypeSafeOptions) {
    if (!opts.apiKey) throw new JudgeError("TypeSafe API key is missing.");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "jev-latest";
    this.baseUrl = (opts.baseUrl ?? "https://api.typesafe.ai").replace(/\/+$/, "");
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async ask<Qs extends Record<string, Question>>(req: JudgeRequest<Qs>): Promise<JudgeResult<Qs>> {
    const body = JSON.stringify({ state: req.state, model: this.model, questions: req.questions });
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoff(attempt++));
          continue;
        }
        throw new JudgeError(`TypeSafe request failed: ${(err as Error).message}`);
      }

      if (res.ok) {
        const data = (await res.json()) as WireResponse;
        validate(data, req.questions);
        return {
          answers: data.answers as JudgeResult<Qs>["answers"],
          model: data.model ?? this.model,
          usage: {
            inputTokens: data.usage?.input_tokens ?? 0,
            outputTokens: data.usage?.output_tokens ?? 0,
          },
          cached: false,
        };
      }

      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        attempt++;
        continue;
      }

      const text = await res.text().catch(() => "");
      const hint =
        res.status === 401
          ? "Missing or invalid TYPESAFE_API_KEY."
          : res.status === 422
            ? "Request failed validation."
            : `HTTP ${res.status}.`;
      throw new JudgeError(`TypeSafe: ${hint} ${text.slice(0, 300)}`.trim(), res.status);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function validate(data: WireResponse, questions: Record<string, Question>): void {
  if (!data || typeof data !== "object" || !data.answers) {
    throw new JudgeError("TypeSafe returned an unexpected response (no answers).");
  }
  for (const [id, q] of Object.entries(questions)) {
    const a = data.answers[id] as Answer | undefined;
    if (!a) throw new JudgeError(`TypeSafe response is missing answer "${id}".`);
    if (q.type === "noul" && typeof (a as { noul?: unknown }).noul !== "number") {
      throw new JudgeError(`Answer "${id}" has no noul probability.`);
    }
    if (q.type === "choice" && typeof (a as { choice?: unknown }).choice !== "string") {
      throw new JudgeError(`Answer "${id}" has no choice.`);
    }
    if (q.type === "score" && typeof (a as { score?: unknown }).score !== "number") {
      throw new JudgeError(`Answer "${id}" has no score.`);
    }
  }
}
