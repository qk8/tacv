/**
 * Confidence trajectory prediction.
 *
 * ── Problem this complements ────────────────────────────────────────────────
 * `checkStagnationImpl` detects stagnation reactively, by comparing the
 * *textual* similarity of consecutive cycles' errors/diffs (Jaccard
 * similarity). That is a strong signal when the agent is genuinely repeating
 * itself, but it has a blind spot: if each cycle's specific failing test
 * happens to differ (different test name, different assertion message) while
 * the *total number* of failing tests stays flat or grows, there is no
 * repeated string for a text-similarity comparison to catch, even though the
 * agent is making zero real progress.
 *
 * ── What this module provides ───────────────────────────────────────────────
 * `assessConfidenceTrajectory` looks at the trend in failing-test count
 * across recent cycles (not the text of the failures) and classifies it as
 * improving / flat / worsening. `predictsStagnation` flags flat or
 * worsening trajectories as an early, proactive warning — usable alongside
 * (not instead of) the existing Jaccard-based detector, feeding the same
 * graduated ladder (`stagnation/ladder.ts`) a second, independent signal.
 */

export interface CycleSnapshot {
  readonly cycle: number;
  readonly failingTestCount: number;
}

export type TrajectoryAssessment = 'improving' | 'flat' | 'worsening' | 'insufficient_data';

const FLAT_BAND = 0.5;
/** Only the most recent transitions determine "where things are headed now" —
 *  an early sharp improvement should not mask a later plateau when averaged
 *  over the entire history. */
const RECENT_WINDOW_DELTAS = 2;

export function assessConfidenceTrajectory(history: CycleSnapshot[]): TrajectoryAssessment {
  if (history.length < 2) return 'insufficient_data';
  const deltas: number[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push(history[i]!.failingTestCount - history[i - 1]!.failingTestCount);
  }
  const recent = deltas.slice(-RECENT_WINDOW_DELTAS);
  const avgDelta = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avgDelta <= -FLAT_BAND) return 'improving';
  if (avgDelta >= FLAT_BAND) return 'worsening';
  return 'flat';
}

export function predictsStagnation(history: CycleSnapshot[]): boolean {
  const assessment = assessConfidenceTrajectory(history);
  return assessment === 'flat' || assessment === 'worsening';
}
