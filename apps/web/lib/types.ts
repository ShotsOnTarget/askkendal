/** Shapes passed from server components to the client map. Plain JSON only. */

export interface MapDecision {
  id: number;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceKey: string;
  theme: string | null;
  urgency: number | null;
  urgencyLabel: string | null;
  isDecision: number | null;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  summary: string | null;
  judgeModel: string | null;
}

export interface DataStatus {
  ok: boolean;
  message?: string;
}
