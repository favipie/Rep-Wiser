/**
 * Visible, configurable criteria for the Workout Intelligence Engine.
 *
 * These are descriptive reporting heuristics, NOT physiological thresholds.
 * The progression decision itself (increase / maintain / review) always comes
 * from `recommend()` in ../progression.ts; nothing here overrides it.
 */
export type AnalysisConfig = {
  /** Comparable sessions (including today) needed to call a rising/falling trend. Matches recommend()'s decline rule. */
  trendSessions: number;
  /** Comparable sessions in a window needed before a *possible* plateau may be mentioned. */
  plateauSessions: number;
  /** Rep counts within this many reps across all working sets are described as consistent. */
  consistentSpread: number;
  /** A first-to-last-set rep drop of at least this fraction of set 1 is mentioned as a large change. */
  largeDropFraction: number;
  /** Comparable sessions (incl. today) at which evidence becomes "moderate" / "stronger". */
  moderateSessions: number;
  strongerSessions: number;
};
export const defaultAnalysisConfig: AnalysisConfig = {
  trendSessions: 3,
  plateauSessions: 4,
  consistentSpread: 1,
  largeDropFraction: 0.3,
  moderateSessions: 3,
  strongerSessions: 4,
};
export const ENGINE_VERSION = 'wie-1.0.0';
export const SCHEMA_VERSION = 1;
