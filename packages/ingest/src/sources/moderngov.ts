import { BlockedError, fetchText, HttpError } from "../http";
import type { SourceAdapter, SourceRunResult } from "../types";

const BASE = "https://westmorlandandfurness.moderngov.co.uk";

const BLOCKED_ADVICE =
  "The council's ModernGov site sits behind a Cloudflare browser check, so automated reading is refused. " +
  "Ask Westmorland and Furness Council to allow the AskKendal crawler, enable the ModernGov web service " +
  "(mgWebService.asmx), or share a regular export of agendas, minutes, reports and the Forward Plan.";

async function probe(path: string): Promise<SourceRunResult> {
  try {
    await fetchText(`${BASE}${path}`);
    return {
      status: "stub",
      httpStatus: 200,
      message:
        "The page is reachable now, but the parser has not been written because the site could not be read during development. Build it against the live markup.",
      documents: [],
    };
  } catch (err) {
    if (err instanceof BlockedError) {
      return { status: "blocked", httpStatus: err.status, message: BLOCKED_ADVICE, documents: [] };
    }
    return {
      status: "error",
      httpStatus: err instanceof HttpError ? err.status : undefined,
      message: (err as Error).message,
      documents: [],
    };
  }
}

/**
 * Committee agendas, minutes and officer reports. Not readable yet: see BLOCKED_ADVICE.
 * The adapter records the block on every run so the council door shows the current status.
 */
export const moderngov: SourceAdapter = {
  key: "moderngov",
  name: "Committee papers (ModernGov: agendas, minutes, reports)",
  baseUrl: `${BASE}/mgListCommittees.aspx`,
  run: () => probe("/mgListCommittees.aspx"),
};

/** Forward Plan of Key Decisions: decisions coming up. Same block as the committee papers. */
export const forwardPlan: SourceAdapter = {
  key: "forward-plan",
  name: "Forward Plan of Key Decisions (ModernGov)",
  baseUrl: `${BASE}/mgListPlans.aspx`,
  run: () => probe("/mgListPlans.aspx"),
};

/** Planning applications. Council door only, once built. */
export const planning: SourceAdapter = {
  key: "planning",
  name: "Planning applications",
  baseUrl: "https://www.westmorlandandfurness.gov.uk/planning-and-building-control/planning/search-planning-application",
  async run() {
    return {
      status: "stub",
      message:
        "Not built yet. The planning search is an interactive portal, and the legacy South Lakeland weekly-list page timed out when tested on 27 September 2026. Planning data will stay behind the council door because it names applicants.",
      documents: [],
    };
  },
};
