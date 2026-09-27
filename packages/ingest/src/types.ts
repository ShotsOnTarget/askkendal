export interface RawDocument {
  /** Stable id within the source, e.g. the URL path. */
  externalId: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  docType: "news" | "minutes" | "agenda" | "report" | "forward-plan" | "planning-list" | "page";
  body: string;
}

export type SourceStatus = "ok" | "blocked" | "error" | "stub";

export interface SourceRunResult {
  status: SourceStatus;
  httpStatus?: number;
  message?: string;
  documents: RawDocument[];
}

export interface SourceContext {
  /** External ids already stored, so adapters can skip re-downloading unchanged items. */
  known: Set<string>;
  /** Re-download items even if known. */
  refetch: boolean;
  /** Upper bound on documents to download in this run. */
  limit: number;
  log: (msg: string) => void;
}

export interface SourceAdapter {
  key: string;
  name: string;
  baseUrl: string;
  run(ctx: SourceContext): Promise<SourceRunResult>;
}
