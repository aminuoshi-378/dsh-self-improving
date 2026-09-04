/**
 * Named constants for internal algorithm thresholds.
 *
 * Y2/Y3: magic numbers in scoring, reflection, injection, feedback, GC and
 * retrieval are centralized here so they can be audited in one place. These
 * are internal tuning knobs — user-facing configuration lives in the plugin
 * Config / rulesSchema instead, not here.
 */

// --- Scoring & difficulty (types/index.ts) ---
export const STEP_EFFICIENCY_DECAY = 0.05
export const LOW_DIFFICULTY_MAX_STEPS = 2
export const MEDIUM_DIFFICULTY_MAX_STEPS = 6

// --- Reflection (reflection.ts) ---
export const REFLECTION_SUCCESS_THRESHOLD = 0.8
export const REFLECTION_FAILURE_THRESHOLD = 0.3

// --- Atomic fact extraction & positive-outcome boost (index.ts) ---
export const EFFECTIVE_FACT_SCORE_THRESHOLD = 0.7
export const FAILED_FACT_SCORE_THRESHOLD = 0.3
export const POSITIVE_OUTCOME_THRESHOLD = 0.7

// --- Pre-step injection best/worst (index.ts, behavior-adapter.ts) ---
export const INJECTION_BEST_THRESHOLD = 0.6
export const INJECTION_WORST_THRESHOLD = 0.4

// --- Implicit negative feedback (index.ts) ---
export const TASK_RESTATED_SIMILARITY_THRESHOLD = 0.7
export const MIN_WORD_LEN = 2
export const LOW_VALUE_TOOL_MAX = 2

// --- Store-size driven retrieval scaling (experience-store.ts, behavior-adapter.ts) ---
export const SMALL_STORE_THRESHOLD = 50
export const MEDIUM_STORE_THRESHOLD = 200
export const HIGH_QUALITY_THRESHOLD = 0.7

// --- Preference distillation (behavior-adapter.ts) ---
export const MIN_TOTAL_FOR_DISTILL = 10
export const POSITIVE_RATE_DISTILL_THRESHOLD = 0.7
export const NEGATIVE_RATE_DISTILL_THRESHOLD = 0.3
export const LOW_AVG_SCORE_THRESHOLD = 0.4
export const HIGH_AVG_SCORE_THRESHOLD = 0.8
export const PREFERENCE_CONFIDENCE_THRESHOLD = 0.3

// --- Confidence adjustments (experience-store.ts) ---
export const CONFIDENCE_DECAY_FACTOR = 0.9
export const MIN_CONFIDENCE = 0.1
export const CONFIDENCE_BOOST = 0.2
export const MAX_CONFIDENCE = 1.0
export const FACT_INITIAL_CONFIDENCE = 0.5
export const FACT_CONFIDENCE_BOOST = 0.1

// --- Generational GC (experience-store.ts) ---
export const PROMOTE_REUSE_THRESHOLD = 1
export const PROMOTE_SCORE_THRESHOLD = 0.8
export const LOW_SCORE_GC_THRESHOLD = 0.5
export const MERGED_OUTCOME_SCORE = 0.85

// --- Transfer confidence & attribution (experience-store.ts, v2 stage B) ---
// transfer_confidence is the "how useful is this experience when transferred to
// a new task" signal, distinct from outcome_confidence ("how sure are we the
// outcome was correct"). It is driven by bidirectional attribution (§4.2).
export const TRANSFER_CONFIDENCE_INITIAL = 0.5
export const TRANSFER_CONFIDENCE_MIN = 0.0
export const TRANSFER_CONFIDENCE_MAX = 1.0
// Reward applied when an injected experience was *used* and the task passed.
export const TRANSFER_REWARD_PASS_USED = 0.1
// Penalty applied when an injected experience was *used* and the task failed.
export const TRANSFER_PENALTY_FAIL_USED = 0.15
// Time decay factor applied on transferConfidence when not revalidated.
export const TRANSFER_DECAY_FACTOR = 0.95

// --- Truth-ground layer (truth-ground.ts) ---
// Outcome confidence by verdict source level: L0 (user-confirmed) is the most
// trustworthy, L3 (process-proxy prior) the weakest. These are the *confidence
// that the verdict is correct*, NOT the transfer usefulness of an experience.
export const VERDICT_CONFIDENCE_L0 = 1.0
export const VERDICT_CONFIDENCE_L1 = 0.8
export const VERDICT_CONFIDENCE_L2 = 0.6
export const VERDICT_CONFIDENCE_L3 = 0.3
// Minimum number of failed tool results (exit code != 0 / test failure) to
// count as an L2 hard-fact "fail" signal.
export const HARD_FACT_FAIL_TOOL_MIN = 1

// --- Paired comparison / arm-based attribution (experience-store.ts, v2 stage D) ---
// Effect size (injected-arm pass rate − baseline pass rate) thresholds and
// minimum sample sizes for adjusting transferConfidence from the paired
// comparison statistics (design-v2 §5.2).
// Minimum "injected" arm samples before a comparison is trusted.
export const ARM_MIN_INJECTED_SAMPLES = 3
// Minimum "baseline" (not-injected) arm samples before a comparison is trusted.
export const ARM_MIN_BASELINE_SAMPLES = 3
// Effect size above which transferConfidence is rewarded (positive effect).
export const ARM_POSITIVE_EFFECT_THRESHOLD = 0.15
// Effect size below (negative) which transferConfidence is penalized.
export const ARM_NEGATIVE_EFFECT_THRESHOLD = -0.15
// transferConfidence delta applied when effect size is significant.
export const ARM_EFFECT_CONFIDENCE_DELTA = 0.1

// --- Layered memory (experience-store.ts, v2 stage E) ---
// memory_tier distinguishes cognitive value layers (design-v2 §6):
//   'event'    — single-task raw record (short-lived, aggregated upward)
//   'strategy' — transferable practice (driven by transferConfidence)
// (atomic facts live in their own atomic_facts table, not in experiences.)
export const MEMORY_TIER_EVENT = 'event'
export const MEMORY_TIER_STRATEGY = 'strategy'
// transferConfidence above which an experience with a lesson is promoted to
// the strategy tier.
export const STRATEGY_PROMOTE_TRANSFER_THRESHOLD = 0.7
// transferConfidence below which a strategy-tier experience is demoted back to
// event tier (it has not proven transferable).
export const STRATEGY_DEMOTE_TRANSFER_THRESHOLD = 0.3
// transferConfidence below which a strategy-tier experience is forgotten.
export const STRATEGY_FORGET_TRANSFER_THRESHOLD = 0.15