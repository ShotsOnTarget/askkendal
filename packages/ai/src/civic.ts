import { choice, noul, score, type Judge, type Usage } from "./types";

/**
 * The judgments AskKendal makes about each public document, asked together in one
 * request because they are independent questions over the same state.
 */

export const THEMES = {
  planning: "Planning and housing: planning applications and decisions, new homes, housing policy, building control, the local plan.",
  transport: "Highways and transport: roads, roadworks, parking, buses, rail, cycling and walking routes, traffic.",
  environment: "Environment and flooding: flood defences, rivers, waste and recycling, climate, parks, green spaces and nature.",
  economy: "Business and the town centre: shops, markets, tourism, jobs, business support, regeneration.",
  community: "Community, culture and leisure: events, arts, heritage, libraries, sport, volunteering, community grants.",
  care: "Health, care and wellbeing: adult social care, public health, support for older or vulnerable people, homelessness.",
  children: "Children, schools and young people: education, school buildings, childcare, youth services, special educational needs.",
  governance: "Council money and democracy: budgets, council tax, elections and polling, councillors, council buildings, audits, enforcement.",
  other: "None of the other themes fits.",
} as const;

export type Theme = keyof typeof THEMES;

export const THEME_LABELS: Record<Theme, string> = {
  planning: "Planning & housing",
  transport: "Roads & transport",
  environment: "Environment & flooding",
  economy: "Business & town centre",
  community: "Community & culture",
  care: "Health & care",
  children: "Schools & young people",
  governance: "Council & democracy",
  other: "Other",
};

export const KENDAL_LEVELS = [
  "Not about Kendal: concerns other towns or places only.",
  "Area-wide: applies across Westmorland and Furness or Cumbria, with Kendal included but not singled out.",
  "Kendal is named as one of several places affected.",
  "Mainly about Kendal: a Kendal place, service, event, business or decision.",
];

export const URGENCY_LEVELS = [
  "Background information: little or no direct effect on residents' day-to-day lives.",
  "Minor or local effect: affects a small group of people or one place, or only for a short time.",
  "Noticeable change: changes a service, place, route, cost or rule that many residents will notice.",
  "Major or time-critical: a significant change, closure, safety or flood risk, or a deadline residents need to act on.",
];

export const URGENCY_LABELS = ["Background", "Minor", "Noticeable", "Major"];

export interface DocumentState {
  title: string;
  source: string;
  published: string | null;
  text: string;
}

export interface LocationCandidate {
  name: string;
  /** Short description shown to the judge, e.g. "street in Kendal". */
  kind: string;
}

export interface DocumentJudgment {
  theme: Theme;
  themeConfidence: number | null;
  kendalRelevance: number;
  isDecision: number | null;
  namesPrivate: number | null;
  urgency: number | null;
  urgencyLabel: string | null;
  /** Index into the candidates passed in, or null for no single place. */
  locationIndex: number | null;
  model: string;
  usage: Usage;
  cached: boolean;
}

/** Longest document excerpt sent to the judge. Keeps token use predictable. */
export const MAX_JUDGE_CHARS = 6000;

export function buildDocumentQuestions(candidates: LocationCandidate[]) {
  const questions = {
    theme: choice(
      "Which council service area is this document mainly about?",
      THEMES as Record<Theme, string>,
    ),
    kendal: score(
      "This document comes from a council covering Westmorland and Furness in Cumbria, England. How much is it about the town of Kendal?",
      KENDAL_LEVELS,
    ),
    decision: noul(
      "Does this document report a decision, approval, change or formal action by a council?",
      {
        true: "It reports something a council has decided, approved, changed, funded, contracted, enforced or formally proposed.",
        false: "It mainly promotes an event, celebrates something, gives advice or shares general information, with no council decision.",
      },
    ),
    private: noul(
      "This document may be summarised on a public website about council business. Does it name private individuals in connection with personal matters?",
      {
        true: "It names or identifies a private individual, such as an applicant, objector, resident, defendant, patient or child, together with personal details or a personal matter.",
        false: "It names nobody, or only public office holders, council staff speaking officially, organisations, businesses, or people quoted in a public capacity.",
      },
    ),
    urgency: score(
      "How much does this document matter to people who live or work in the area it covers?",
      URGENCY_LEVELS,
    ),
  };
  if (candidates.length < 2) return questions;
  const options: Record<string, string> = {};
  candidates.forEach((c, i) => {
    options[`place_${i}`] = `${c.name} (${c.kind})`;
  });
  options.none = "No single place: the document covers several places, the whole town or area, or a place not listed.";
  return {
    ...questions,
    location: choice("Which listed place is the main location this document is about?", options),
  };
}

export function documentState(doc: DocumentState): DocumentState {
  return { ...doc, text: doc.text.slice(0, MAX_JUDGE_CHARS) };
}

/** Ask the judge about one document. */
export async function judgeDocument(
  judge: Judge,
  doc: DocumentState,
  candidates: LocationCandidate[],
): Promise<DocumentJudgment> {
  const questions = buildDocumentQuestions(candidates);
  const result = await judge.ask({ state: documentState(doc), questions, purpose: "classify-document" });
  const a = result.answers as Record<string, any>;

  let locationIndex: number | null = candidates.length === 1 ? 0 : null;
  if (a.location) {
    const picked: string = a.location.choice;
    const p = a.location.probabilities?.[picked] ?? 0;
    if (picked !== "none" && p >= 0.5) locationIndex = Number(picked.replace("place_", ""));
  }
  const urgency = typeof a.urgency?.score === "number" ? a.urgency.score : null;
  return {
    theme: (a.theme?.choice as Theme) ?? "other",
    themeConfidence: a.theme?.confidence ?? null,
    kendalRelevance: a.kendal.score,
    isDecision: a.decision.noul,
    namesPrivate: a.private.noul,
    urgency,
    urgencyLabel: urgency === null ? null : URGENCY_LABELS[Math.round(urgency)] ?? null,
    locationIndex,
    model: result.model,
    usage: result.usage,
    cached: result.cached,
  };
}

const THEME_KEYWORDS: Array<[Theme, RegExp]> = [
  ["planning", /\b(planning|housing|homes|development|local plan)\b/i],
  ["transport", /\b(road|roads|parking|bus|buses|traffic|highway|cycle|rail|junction)\b/i],
  ["environment", /\b(flood|river|recycling|waste|climate|park|nature|trees)\b/i],
  ["economy", /\b(business|shop|shops|market|tourism|town centre|jobs)\b/i],
  ["care", /\b(care|health|wellbeing|homeless|carers)\b/i],
  ["children", /\b(school|schools|children|young people|youth|SEND)\b/i],
  ["community", /\b(festival|event|arts|heritage|library|museum|sport|volunteer)\b/i],
  ["governance", /\b(budget|council tax|election|polling|councillor|audit|court)\b/i],
];

/**
 * Keyword rules used when no judge is configured. Deliberately cautious: the privacy
 * judgment is left unknown so the caller decides from the source type.
 */
export function ruleBasedJudgment(doc: DocumentState, candidates: LocationCandidate[]): DocumentJudgment {
  const text = `${doc.title}\n${doc.text}`;
  const theme = THEME_KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? "other";
  const kendalInTitle = /\bKendal\b/.test(doc.title);
  const kendalInText = /\bKendal\b/.test(doc.text);
  return {
    theme,
    themeConfidence: null,
    kendalRelevance: kendalInTitle ? 3 : kendalInText ? 2 : 0.5,
    isDecision: null,
    namesPrivate: null,
    urgency: null,
    urgencyLabel: null,
    locationIndex: candidates.length > 0 ? 0 : null,
    model: "rules",
    usage: { inputTokens: 0, outputTokens: 0 },
    cached: false,
  };
}
