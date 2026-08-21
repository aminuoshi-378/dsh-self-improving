/**
 * Task Suite — 20 predefined agent task scenarios.
 *
 * Each task defines:
 *   - An optimal tool sequence (the "right way" to solve it)
 *   - Common mistakes an agent makes WITHOUT learned experience
 *   - A workspace fingerprint for ExperienceStore matching
 *
 * The simulator uses this data to produce realistic TurnData:
 *   - Without experience: agent follows optimal path but makes mistakes
 *     (wrong tool, repeated calls, unnecessary steps)
 *   - With experience: agent avoids those mistakes (experience was injected)
 */

export interface TaskScenario {
  id: string
  taskPattern: 'bugfix' | 'feature' | 'refactoring' | 'search' | 'test-writing'
  description: string
  workspaceDigest: string

  /** The optimal tool sequence */
  optimalPath: string[]

  /**
   * Mistakes an agent tends to make without experience.
   * Each mistake has a probability of occurring when no experience is injected.
   * When experience IS injected, the probability drops significantly.
   */
  mistakes: {
    /** Wrong tool called instead of the correct one */
    wrongTool?: { tool: string; insteadOf: string; probability: number }
    /** Same tool called multiple times in a row (triggers guard) */
    repeatCall?: { tool: string; probability: number }
    /** Unnecessary extra step that wastes tokens */
    extraStep?: { tool: string; probability: number }
    /** Goal stalls — agent doesn't complete the task efficiently */
    stalls?: { probability: number }
  }

  /** Expected user feedback when task goes well vs poorly */
  feedbackOnSuccess: 'positive' | 'none'
  feedbackOnFailure: 'negative' | 'none'
}

export const TASK_SUITE: TaskScenario[] = [
  // --- Bugfix tasks (6) ---
  {
    id: 'bug-1',
    taskPattern: 'bugfix',
    description: 'Fix null pointer in user service',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'edit_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.4 },
      repeatCall: { tool: 'read_file', probability: 0.3 },
      stalls: { probability: 0.2 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'bug-2',
    taskPattern: 'bugfix',
    description: 'Fix race condition in request handler',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'read_file', 'edit_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'read_file', probability: 0.4 },
      extraStep: { tool: 'write_file', probability: 0.3 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'bug-3',
    taskPattern: 'bugfix',
    description: 'Fix memory leak in connection pool',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'edit_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.3 },
      repeatCall: { tool: 'grep', probability: 0.25 },
      stalls: { probability: 0.25 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'bug-4',
    taskPattern: 'bugfix',
    description: 'Fix incorrect API response format',
    workspaceDigest: 'ws-api',
    optimalPath: ['grep', 'read_file', 'edit_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.4 },
      extraStep: { tool: 'read_file', probability: 0.35 },
      stalls: { probability: 0.15 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'bug-5',
    taskPattern: 'bugfix',
    description: 'Fix broken type annotation in utils',
    workspaceDigest: 'ws-shared',
    optimalPath: ['grep', 'read_file', 'edit_file'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.3 },
      repeatCall: { tool: 'read_file', probability: 0.3 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'bug-6',
    taskPattern: 'bugfix',
    description: 'Fix off-by-one error in pagination',
    workspaceDigest: 'ws-api',
    optimalPath: ['grep', 'read_file', 'edit_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'edit_file', probability: 0.25 },
      stalls: { probability: 0.2 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },

  // --- Feature tasks (5) ---
  {
    id: 'feat-1',
    taskPattern: 'feature',
    description: 'Add input validation to login form',
    workspaceDigest: 'ws-frontend',
    optimalPath: ['read_file', 'grep', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'read_file', probability: 0.35 },
      repeatCall: { tool: 'write_file', probability: 0.3 },
      extraStep: { tool: 'read_file', probability: 0.4 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'feat-2',
    taskPattern: 'feature',
    description: 'Add logging middleware',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.3 },
      extraStep: { tool: 'read_file', probability: 0.35 },
      stalls: { probability: 0.2 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'feat-3',
    taskPattern: 'feature',
    description: 'Add retry logic for API calls',
    workspaceDigest: 'ws-api',
    optimalPath: ['grep', 'read_file', 'read_file', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'read_file', probability: 0.4 },
      extraStep: { tool: 'write_file', probability: 0.25 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'feat-4',
    taskPattern: 'feature',
    description: 'Add dark mode toggle',
    workspaceDigest: 'ws-frontend',
    optimalPath: ['read_file', 'grep', 'write_file', 'write_file'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.3 },
      repeatCall: { tool: 'write_file', probability: 0.35 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'feat-5',
    taskPattern: 'feature',
    description: 'Add rate limiting to auth endpoint',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.4 },
      extraStep: { tool: 'read_file', probability: 0.3 },
      stalls: { probability: 0.2 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },

  // --- Refactoring tasks (4) ---
  {
    id: 'refactor-1',
    taskPattern: 'refactoring',
    description: 'Extract utility function from duplicated code',
    workspaceDigest: 'ws-shared',
    optimalPath: ['grep', 'read_file', 'read_file', 'edit_file', 'edit_file'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.3 },
      repeatCall: { tool: 'read_file', probability: 0.35 },
      extraStep: { tool: 'edit_file', probability: 0.25 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'refactor-2',
    taskPattern: 'refactoring',
    description: 'Replace callback chain with async/await',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'edit_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'edit_file', probability: 0.3 },
      stalls: { probability: 0.2 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
  {
    id: 'refactor-3',
    taskPattern: 'refactoring',
    description: 'Split large component into smaller ones',
    workspaceDigest: 'ws-frontend',
    optimalPath: ['grep', 'read_file', 'write_file', 'write_file', 'edit_file'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.3 },
      repeatCall: { tool: 'write_file', probability: 0.35 },
      extraStep: { tool: 'read_file', probability: 0.3 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'refactor-4',
    taskPattern: 'refactoring',
    description: 'Consolidate error handling into middleware',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'edit_file', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'read_file', probability: 0.3 },
      stalls: { probability: 0.15 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },

  // --- Search tasks (3) ---
  {
    id: 'search-1',
    taskPattern: 'search',
    description: 'Find all usages of deprecated API method',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'grep', 'read_file'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.45 },
      repeatCall: { tool: 'grep', probability: 0.35 },
    },
    feedbackOnSuccess: 'none',
    feedbackOnFailure: 'none',
  },
  {
    id: 'search-2',
    taskPattern: 'search',
    description: 'Find the config file that sets timeout',
    workspaceDigest: 'ws-api',
    optimalPath: ['grep', 'read_file'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.4 },
      extraStep: { tool: 'read_file', probability: 0.35 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'search-3',
    taskPattern: 'search',
    description: 'Find where database connections are initialized',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'read_file'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.4 },
      repeatCall: { tool: 'read_file', probability: 0.3 },
      stalls: { probability: 0.15 },
    },
    feedbackOnSuccess: 'none',
    feedbackOnFailure: 'none',
  },

  // --- Test writing tasks (2) ---
  {
    id: 'test-1',
    taskPattern: 'test-writing',
    description: 'Write unit tests for user service',
    workspaceDigest: 'ws-backend',
    optimalPath: ['grep', 'read_file', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'list_files', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'read_file', probability: 0.3 },
      extraStep: { tool: 'write_file', probability: 0.3 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'none',
  },
  {
    id: 'test-2',
    taskPattern: 'test-writing',
    description: 'Write integration tests for auth flow',
    workspaceDigest: 'ws-api',
    optimalPath: ['grep', 'read_file', 'read_file', 'write_file', 'run_tests'],
    mistakes: {
      wrongTool: { tool: 'glob', insteadOf: 'grep', probability: 0.35 },
      repeatCall: { tool: 'read_file', probability: 0.4 },
      stalls: { probability: 0.2 },
    },
    feedbackOnSuccess: 'positive',
    feedbackOnFailure: 'negative',
  },
]
