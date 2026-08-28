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