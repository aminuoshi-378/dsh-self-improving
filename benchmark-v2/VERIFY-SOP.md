# VERIFY-SOP：数据集验证操作手册（新手版）

前提：终端 + Node >= 22。所有命令在 benchmark-v2 仓库目录（本地 clone 路径，下称 `<BENCH_ROOT>`）下执行。
每一步都给出：命令 → 期望看到什么 → 不对时怎么办。

---

## Step 0：环境确认（10 秒）

```sh
cd <BENCH_ROOT>
node --version        # 期望 v22.x 或更高
```

不对 → 检查 node 是否安装（`which node`）。

---

## Step 1：全量机器验证门（最重要，2 分钟）

```sh
node src/run.mjs verify-seeds
```

**期望输出**：
- 每行形如 `OK   u7: seed fails / solution passes`（共 100 行）
- 最后一行：`verify-seeds OK: all 100 tasks valid (seed fails, solution passes)`

**这一步在证明什么**：每道题机器实测了两件事——
1. `seed fails`：坏种子跑 test.cjs **必须挂**（题目确实有可测缺陷，不是白给）
2. `solution passes`：参考解跑 test.cjs **必须过**（题目可解、判分器没写错）

出现任何 `BAD` 行 → 把整行输出贴回来，不用自己修。

---

## Step 2：理解一题长什么样（5 分钟，抽 a9 示范）

```sh
cat tasks/async/a9/bug.cjs      # 坏种子：看 // BUGGY 注释说明错在哪
cat tasks/async/a9/test.cjs      # 判分器：看断言查什么值
cat solutions/async/a9.cjs      # 参考解：正确的写法
```

**新手自查清单**（对着三个文件打勾）：
- [ ] bug 是"真实会犯的错"吗？（不是一眼假的弱智 bug）
- [ ] test 断言查的是**精确值**吗？（`=== 3`，不是"大约/包含"）
- [ ] bug.cjs 的注释里有没有泄漏答案？
- [ ] test 依赖运行目录、网络或随机吗？（不应该）

任何一格打不了勾 → 记下题号，贴回来讨论。

---

## Step 3：亲手验证一道题（5 分钟，眼见为实）

```sh
# 3.1 跑坏种子 —— 期望 FAIL、exit=1
cd tasks/async/a9 && node test.cjs; echo "exit=$?"     # 期望输出 FAIL: ... exit=1
cd ../../

# 3.2 套上参考解再跑 —— 期望 PASS、exit=0
mkdir -p /tmp/check-a9
cp tasks/async/a9/test.cjs /tmp/check-a9/
cp solutions/async/a9.cjs /tmp/check-a9/bug.cjs
cd /tmp/check-a9 && node test.cjs; echo "exit=$?"      # 期望 PASS: ... exit=0
```

**记住这个原则**：`exit=0/1` 是基准判分的**唯一**依据。agent 自称"修好了"不算数——runner 会在 arena 里独立跑 test.cjs。

---

## Step 4：抽查 3 题的"难度质量"（5 分钟）

建议抽：**j9**（invert 冲突语义）、**d9**（UTC 字段填充）、**a9**（firstTruthy 早停）。

对每题用两个新手判据：
1. **你 30 秒内能看出 bug 吗？** 能 → 对强模型可能偏简单，记下来（这是已知问题：pass 率饱和）
2. **test 有没有覆盖最容易漏的边界**（空输入、越界、emoji、跨年）？没有 → 判分偏松，记下来

产出：一张三行的清单，"题号 + 简单/合适 + 判分严不严"，贴回来即可。

---

## Step 5：manifest 一致性检查（1 分钟）

```sh
node -e "
const m = require('./tasks/manifest.json')
console.log('train:', m.train.length, '| test:', m.test.length, '| tasks:', m.tasks.length)
const overlap = m.tasks.filter(t => m.train.includes(t.id) && m.test.includes(t.id))
console.log('train/test 重叠:', overlap.length === 0 ? '无(正确)' : overlap.map(t => t.id).join(','))
const missingPrompt = m.tasks.filter(t => !t.prompt || t.prompt.length < 20)
console.log('缺 prompt 的任务:', missingPrompt.length === 0 ? '无(正确)' : missingPrompt.map(t => t.id).join(','))
"
```

**期望**：`train: 50 | test: 50 | tasks: 100`，重叠=无，缺 prompt=无。

---

## Step 6：端到端管线验证（可选，约 5 分钟，跑 3 次真实 agent）

```sh
node src/run.mjs prepare   # 重建插件 + 校验三个 profile + 注册 arena
node src/run.mjs smoke     # 3 次真实运行：baseline 测试 x1，enabled 训练 x1 + 测试 x1(只读库)
```

**期望**：浏览器窗口可见地自动跑 3 题，全部 `PASS`，最后生成 `runs/smoke-*/report.md`。

---

## 判定速查表

| 现象 | 结论 | 动作 |
|---|---|---|
| verify-seeds 全 OK | 题目"合法"（可挂可过） | 继续 Step 4 查难度 |
| 出现 BAD 行 | 题目或判分器有错 | 贴输出，勿手改 |
| 你秒看出 bug | 题目偏简单（合法但没区分度） | 记题号，汇入加难度计划 |
| agent 说 PASS 但 test 挂 | 正常防糊弄机制 | 以 exit code 为准 |
| test 断言太松（只查"不抛错"） | 判分质量弱 | 记题号，加严断言 |

## 耗时预算

| 步骤 | 用时 | 需要联网/LLM? |
|---|---|---|
| Step 1 verify-seeds | ~25 秒 | 否 |
| Step 2-5 人工抽查 | ~15 分钟 | 否 |
| Step 6 smoke | ~5 分钟 | 是（3 次小 LLM 调用） |
