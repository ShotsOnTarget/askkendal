/**
 * Which documents the public door may show. Kept in one place so the rule is easy to audit.
 *
 * - Planning material stays behind the council door for now (applicants' names and addresses).
 * - Press releases are written for publication, so they are public unless Jev thinks they
 *   name private individuals in a personal matter (threshold deliberately low).
 * - Anything else needs a privacy judgment before it can be public.
 */
export const PRESS_SOURCES = new Set(["council-news", "town-council"]);
export const PRIVATE_THRESHOLD = 0.3;

export function isPublicDocument(sourceKey: string, docType: string, namesPrivate: number | null): boolean {
  if (sourceKey === "planning" || docType === "planning-list") return false;
  if (namesPrivate === null) return PRESS_SOURCES.has(sourceKey);
  return namesPrivate < PRIVATE_THRESHOLD;
}

/** Kendal relevance score (0..3) at or above which a document is placed on the Kendal map. */
export const KENDAL_MAP_THRESHOLD = 1.5;
