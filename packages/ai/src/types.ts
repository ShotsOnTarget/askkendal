/**
 * Typed judgments. A Judge answers small questions about some state and returns
 * probabilities, not prose. TypeSafe's Jev is the first backend; the interface is
 * provider-agnostic so another backend can slot in later.
 */

export type Instructions = string | Record<string, unknown> | unknown[];

export interface NoulQuestion {
  type: "noul";
  instructions: Instructions;
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion<K extends string = string> {
  type: "choice";
  instructions: Instructions;
  criteria: Record<K, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: Instructions;
  /** Ordered levels, lowest first. At most 10. */
  criteria: string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  /** Probability that the condition holds, 0..1. */
  noul: number;
}

export interface ChoiceAnswer<K extends string = string> {
  type: "choice";
  choice: K;
  probabilities: Record<K, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted level index, 0..levels-1. Can fall between levels. */
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type AnswerFor<Q> = Q extends ChoiceQuestion<infer K>
  ? ChoiceAnswer<K>
  : Q extends ScoreQuestion
    ? ScoreAnswer
    : NoulAnswer;

export type Answers<Qs extends Record<string, Question>> = { [K in keyof Qs]: AnswerFor<Qs[K]> };

export interface JudgeRequest<Qs extends Record<string, Question>> {
  state: unknown;
  questions: Qs;
  /** Short label stored with the usage record, e.g. "classify-document". */
  purpose: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeResult<Qs extends Record<string, Question>> {
  answers: Answers<Qs>;
  model: string;
  usage: Usage;
  cached: boolean;
}

export interface Judge {
  readonly provider: string;
  readonly model: string;
  ask<Qs extends Record<string, Question>>(req: JudgeRequest<Qs>): Promise<JudgeResult<Qs>>;
}

/** Question builders that keep literal option keys in the type. */
export const noul = (instructions: Instructions, criteria?: { true: string; false: string }): NoulQuestion => ({
  type: "noul",
  instructions,
  ...(criteria ? { criteria } : {}),
});

export const choice = <K extends string>(instructions: Instructions, criteria: Record<K, string>): ChoiceQuestion<K> => ({
  type: "choice",
  instructions,
  criteria,
});

export const score = (instructions: Instructions, criteria: string[]): ScoreQuestion => {
  if (criteria.length < 2 || criteria.length > 10) throw new Error("A score question needs 2 to 10 levels.");
  return { type: "score", instructions, criteria };
};
