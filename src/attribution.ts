/**
 * Paired-comparison effect size — v2 (stage D)
 *
 * Pure, deterministic statistics for the arm-based attribution experiment
 * (design-v2 §5.2). A single injected experience E is evaluated by comparing
 * the pass rate of tasks where E was *used* (the "injected arm") against the
 * pass rate of otherwise-comparable tasks where E was NOT used (the baseline).
 *
 * The effect size drives transferConfidence:
 *   - effect >= POSITIVE_THRESHOLD → reward (E demonstrably helps)
 *   - effect <= NEGATIVE_THRESHOLD → penalty (E demonstrably hurts)
 *   - otherwise                     → no change (insufficient evidence)
 *
 * This replaces the naive "pass → reward" association with a real controlled
 * comparison: it only moves transferConfidence when E's contribution is
 * separable from the base success rate.
 */

import {
  ARM_MIN_INJECTED_SAMPLES,
  ARM_MIN_BASELINE_SAMPLES,
  ARM_POSITIVE_EFFECT_THRESHOLD,
  ARM_NEGATIVE_EFFECT_THRESHOLD,
} from './types/constants.js'

/** Aggregated counts for one experience's two arms. */
export interface ArmCounts {
  /** Number of tasks where the experience was used. */
  injectedTotal: number
  /** Number of those tasks that passed. */
  injectedPass: number
  /** Number of comparable tasks where the experience was NOT used. */
  baselineTotal: number
  /** Number of those baseline tasks that passed. */
  baselinePass: number
}

/** The outcome of a comparison: a signed direction or "insufficient evidence". */
export type EffectDirection = 'reward' | 'penalty' | 'neutral'

/** Result of computing an effect size. */
export interface EffectResult {
  /** Signed effect size (injected pass rate − baseline pass rate), or 0 when undefined. */
  effectSize: number
  direction: EffectDirection
  /** Whether enough samples existed to compute a trustworthy comparison. */
  sufficient: boolean
}

/**
 * Compute the effect size for an experience's two arms.
 *
 * Pass rate of an arm = pass / total. Effect size = injectedPassRate − baselinePassRate.
 * A comparison is "sufficient" only when BOTH arms meet their minimum sample
 * sizes (otherwise the estimate is noise and must not drive a confidence change).
 *
 * @param counts - aggregated arm counts for one experience.
 * @returns the effect-size result.
 */
export function computeEffectSize(counts: ArmCounts): EffectResult {
  const injectedSufficient = counts.injectedTotal >= ARM_MIN_INJECTED_SAMPLES
  const baselineSufficient = counts.baselineTotal >= ARM_MIN_BASELINE_SAMPLES
  const sufficient = injectedSufficient && baselineSufficient

  if (!sufficient) {
    return { effectSize: 0, direction: 'neutral', sufficient: false }
  }

  const injectedPassRate = counts.injectedPass / counts.injectedTotal
  const baselinePassRate = counts.baselinePass / counts.baselineTotal
  const effectSize = injectedPassRate - baselinePassRate

  if (effectSize >= ARM_POSITIVE_EFFECT_THRESHOLD) {
    return { effectSize, direction: 'reward', sufficient: true }
  }
  if (effectSize <= ARM_NEGATIVE_EFFECT_THRESHOLD) {
    return { effectSize, direction: 'penalty', sufficient: true }
  }
  return { effectSize, direction: 'neutral', sufficient: true }
}

/**
 * Aggregate raw attribution triples into arm counts for one experience.
 *
 * @param records - raw (used, passed) triples for a single experience within a
 *                  comparable semantic cluster. The baseline arm is the subset
 *                  where `used === false`; the injected arm is `used === true`.
 * @returns the aggregated ArmCounts.
 */
export function aggregateArms(records: { used: boolean; passed: boolean }[]): ArmCounts {
  let injectedTotal = 0
  let injectedPass = 0
  let baselineTotal = 0
  let baselinePass = 0
  for (const r of records) {
    if (r.used) {
      injectedTotal++
      if (r.passed) injectedPass++
    } else {
      baselineTotal++
      if (r.passed) baselinePass++
    }
  }
  return { injectedTotal, injectedPass, baselineTotal, baselinePass }
}