const DEFAULT_UA = "AskKendal/0.1 (civic information project for Kendal, Cumbria)";

export class BlockedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BlockedError";
  }
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const lastRequest = new Map<string, number>();

/** Be a good citizen: at most one request per host every `gapMs`. */
async function politeWait(url: string, gapMs: number) {
  const host = new URL(url).host;
  const wait = (lastRequest.get(host) ?? 0) + gapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest.set(host, Date.now());
}

/** True when a response is a bot-protection challenge page rather than content. */
export function isChallenge(status: number, body: string): boolean {
  if (status !== 403 && status !== 503 && status !== 429) return false;
  return /Just a moment|cf-chl|challenge-platform|Attention Required|captcha/i.test(body);
}

export interface FetchTextOptions {
  gapMs?: number;
  accept?: string;
  timeoutMs?: number;
}

/** GET a URL as text with an honest user agent, politeness delay and challenge detection. */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  await politeWait(url, opts.gapMs ?? 800);
  const res = await fetch(url, {
    headers: {
      "User-Agent": process.env.INGEST_USER_AGENT || DEFAULT_UA,
      Accept: opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const body = await res.text();
  if (isChallenge(res.status, body)) {
    throw new BlockedError(`${new URL(url).host} returned a bot-protection challenge (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) throw new HttpError(`GET ${url} failed with HTTP ${res.status}`, res.status);
  return body;
}

export async function fetchJson<T>(url: string, opts: FetchTextOptions = {}): Promise<T> {
  return JSON.parse(await fetchText(url, { ...opts, accept: "application/json" })) as T;
}
