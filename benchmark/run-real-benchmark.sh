#!/bin/bash
#
# Real LLM A/B Benchmark for dsh-self-improving
#
# Phase 1: BASELINE — 5 tasks with baseline profile (no self-improving plugin)
# Phase 2: WARMUP   — 5 varied tasks with benchmark profile (accumulate experience)
# Phase 3: ENABLED   — same 5 tasks with benchmark profile (has accumulated experience)
# Phase 4: COMPARE  — compute improvement percentages

set -euo pipefail

PROJECT_DIR="/Users/xh/project/dsh-self-improving"
TASKS_DIR="$PROJECT_DIR/benchmark-tasks"
DSH_DIR="/Users/xh/project/deepseek-harness"
RESULTS_DIR="$PROJECT_DIR/benchmark-results"
DATE_TAG=$(date +%Y%m%d-%H%M%S)

# Work dirs are INSIDE the dsh repo so pnpm exec can resolve modules
WORK_BASE="$DSH_DIR/benchmark-workspace"
mkdir -p "$WORK_BASE"

mkdir -p "$RESULTS_DIR/$DATE_TAG"

get_task_prompt() {
  case "$1" in
    1) echo "Fix the off-by-one error in range(n) in bug.cjs. The function should return numbers from 1 to n inclusive. Currently the loop condition is wrong. After fixing, run: node test.cjs" ;;
    2) echo "Fix the null check in greet(name) in bug.cjs. greet(null) should return 'Hello, stranger!' instead of throwing. After fixing, run: node test.cjs" ;;
    3) echo "Fix the duplicate removal logic in removeDuplicates in bug.cjs. It should keep the first occurrence of each value and remove subsequent duplicates, preserving order. The filter logic is inverted. After fixing, run: node test.cjs" ;;
    4) echo "Fix the async error handling in fetchData in bug.cjs. When shouldFail is true, the error is caught but not re-thrown. The function should throw on error, not return undefined. After fixing, run: node test.cjs" ;;
    5) echo "Fix the string reversal in bug.cjs to handle multi-byte Unicode (emoji). Using split('') breaks surrogate pairs. Use Array.from() or spread operator instead to iterate by code points. After fixing, run: node test.cjs" ;;
    *) echo "" ;;
  esac
}

WARMUP_PROMPTS=(
  "Read bug.cjs and explain what the function does and what bugs you can see. Don't fix anything, just analyze."
  "Read bug.cjs, identify the bug, and write a comment explaining the fix needed. Don't edit the file."
  "Read bug.cjs and write a new test case that would fail with the current buggy code. Don't edit bug.cjs."
  "Read bug.cjs and suggest two possible ways to fix the bug. Don't edit the file, just describe the approaches."
  "Read bug.cjs, identify the bug, then fix it and run: node test.cjs"
)

run_task() {
  local task_num="$1"
  local prompt="$2"
  local results_file="$3"
  local profile="$4"
  local run_label="$5"

  local task_id="task-$task_num"
  local task_dir="$TASKS_DIR/$task_id"
  local work_dir="$WORK_BASE/${run_label}-${task_id}"
  rm -rf "$work_dir"
  mkdir -p "$work_dir"
  cp "$task_dir"/* "$work_dir/"

  local start_time=$(date +%s)

  # Run dsh: cd to work_dir (sets cwd for agent), but invoke pnpm from dsh dir
  local output
  output=$( cd "$work_dir" && cd "$DSH_DIR" && pnpm exec dsh --profile "$profile" "$prompt" 2>&1 || true )

  local end_time=$(date +%s)
  local duration=$((end_time - start_time))

  # Check if the test passes now
  local test_result
  local pass=0
  if test_result=$(node "$work_dir/test.cjs" 2>&1); then
    pass=1
  fi

  # Count tool calls from session log
  local tool_calls=0
  local sessions_dir="$work_dir/.sessions"
  if [ -d "$sessions_dir" ]; then
    tool_calls=$(find "$sessions_dir" -name "*.jsonl" -exec grep -c "tool/call" {} \; 2>/dev/null | paste -sd+ - | bc 2>/dev/null || echo 0)
  fi

  echo "${task_id},${pass},${duration},${tool_calls}" >> "$results_file"

  echo "  Task: $task_id | Pass: $pass | Time: ${duration}s | Tools: $tool_calls"
  if [ "$pass" -eq 0 ]; then
    echo "  Test: $(echo "$test_result" | head -2)"
  fi
}

# =========================================================================
echo ""
echo "============================================================"
echo "Phase 1: BASELINE (baseline profile, no self-improving plugin)"
echo "============================================================"

BASELINE_RESULTS="$RESULTS_DIR/$DATE_TAG/baseline.csv"
echo "task_id,pass,duration_s,tool_calls" > "$BASELINE_RESULTS"

for i in 1 2 3 4 5; do
  echo "Running task-$i (baseline)..."
  run_task "$i" "$(get_task_prompt $i)" "$BASELINE_RESULTS" "baseline" "baseline"
done

# =========================================================================
echo ""
echo "============================================================"
echo "Phase 2: WARMUP (accumulate experience with varied prompts)"
echo "============================================================"

WARMUP_RESULTS="$RESULTS_DIR/$DATE_TAG/warmup.csv"
echo "task_id,pass,duration_s,tool_calls" > "$WARMUP_RESULTS"

for i in 0 1 2 3 4; do
  task_num=$(( (i % 5) + 1 ))
  prompt="${WARMUP_PROMPTS[$i]}"
  echo "Warmup $((i+1))/5: task-$task_num"
  run_task "$task_num" "$prompt" "$WARMUP_RESULTS" "benchmark" "warmup-$((i+1))"
done

# =========================================================================
echo ""
echo "============================================================"
echo "Phase 3: ENABLED (self-improving plugin active with accumulated experience)"
echo "============================================================"

ENABLED_RESULTS="$RESULTS_DIR/$DATE_TAG/enabled.csv"
echo "task_id,pass,duration_s,tool_calls" > "$ENABLED_RESULTS"

for i in 1 2 3 4 5; do
  echo "Running task-$i (enabled)..."
  run_task "$i" "$(get_task_prompt $i)" "$ENABLED_RESULTS" "benchmark" "enabled"
done

# =========================================================================
echo ""
echo "============================================================"
echo "Phase 4: RESULTS COMPARISON"
echo "============================================================"
echo ""

count_passes() { awk -F, 'NR>1 && $2==1 { c++ } END { print c+0 }' "$1"; }
avg_time()     { awk -F, 'NR>1 { s+=$3; c++ } END { if(c>0) printf "%.1f", s/c; else print "0" }' "$1"; }
avg_tools()    { awk -F, 'NR>1 { s+=$4; c++ } END { if(c>0) printf "%.1f", s/c; else print "0" }' "$1"; }

baseline_pass=$(count_passes "$BASELINE_RESULTS")
enabled_pass=$(count_passes "$ENABLED_RESULTS")
baseline_time=$(avg_time "$BASELINE_RESULTS")
enabled_time=$(avg_time "$ENABLED_RESULTS")
baseline_tools=$(avg_tools "$BASELINE_RESULTS")
enabled_tools=$(avg_tools "$ENABLED_RESULTS")

total=5
b_rate=$(echo "scale=0; $baseline_pass * 100 / $total" | bc)
e_rate=$(echo "scale=0; $enabled_pass * 100 / $total" | bc)

echo "  Metric                |  Baseline     |  Enabled      |  Change"
echo "-------------------------|---------------|---------------|----------"
printf "  Task Completion Rate   |  %3d%%         |  %3d%%         |" "$b_rate" "$e_rate"
if [ "$b_rate" -gt 0 ]; then
  imp=$(echo "scale=1; ($e_rate - $b_rate) * 100 / $b_rate" | bc)
  printf "  +%s%%\n" "$imp"
else
  echo "  N/A"
fi

printf "  Avg Duration (s)       |  %-5s         |  %-5s         |" "$baseline_time" "$enabled_time"
bt=$(echo "$baseline_time" | bc); et=$(echo "$enabled_time" | bc)
if [ "$(echo "$bt > 0" | bc)" -eq 1 ]; then
  timp=$(echo "scale=1; ($bt - $et) * 100 / $bt" | bc)
  printf "  %s%%\n" "$timp"
else
  echo "  N/A"
fi

printf "  Avg Tool Calls         |  %-5s         |  %-5s         |" "$baseline_tools" "$enabled_tools"
bto=$(echo "$baseline_tools" | bc); eto=$(echo "$enabled_tools" | bc)
if [ "$(echo "$bto > 0" | bc)" -eq 1 ]; then
  toim=$(echo "scale=1; ($bto - $eto) * 100 / $bto" | bc)
  printf "  %s%%\n" "$toim"
else
  echo "  N/A"
fi

echo ""
echo "Results saved to: $RESULTS_DIR/$DATE_TAG/"
