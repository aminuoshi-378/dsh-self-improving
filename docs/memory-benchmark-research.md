# Agent 记忆系统测试基准调研

调研 GitHub 上专门测试 agent 记忆系统的基准测试用例，用于评估 dsh-self-improving 的跨会话经验记忆能力。

所有仓库均已验证存在（HTTP 200），并实际下载数据确认包含真实测试 prompt。

---

## 选型标准

dsh-self-improving 是跨会话经验记忆系统：agent 完成任务后评分存入经验库，下次任务时注入相关经验。要有效测试它，需要：

1. **连续多轮、跨会话的任务** — 后续任务依赖前面任务的结果
2. **信息更新场景** — 用户纠正之前的决策，记忆系统需要用新信息覆盖旧信息
3. **冲突解决场景** — 相同上下文的不同经验，需要正确选择最新/最优的

因此重点寻找"难度大的连续任务"：跨很多轮、信息穿插分布、需要准确回忆特定细节的场景。

---

## 推荐基准（按优先级排序）

### 1. LongMemEval — 最全面的交互式记忆基准

- **URL**: https://github.com/xiaowu0162/longmemeval
- **V2**: https://github.com/xiaowu0162/LongMemEval-V2
- **论文**: ICLR 2025, "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory" (arXiv:2410.10813)
- **数据**: HuggingFace `xiaowu0162/longmemeval-cleaned`
- **许可证**: MIT

#### 设计特点

Needle-in-a-haystack 设计：将关键证据信息隐藏在大量无关 session 中。证据是间接透露的（如讨论汽车保险时无意中提到买了新车），而非直接声明，增加提取难度。

两个规模：
- **LongMemEval_S**：每个问题约 115K tokens（~40 个 session）
- **LongMemEval_M**：每个问题约 1.5M tokens（~500 个 session）

LLM 在 LongMemEval_S 上准确率下降 30%-60%。

#### 500 个问题，7 种类型，测试 5 种能力

| 问题类型 | 能力 | 说明 | 难度 |
|---|---|---|---|
| single-session-user | 信息提取 | 回忆用户提到的细节 | 中 |
| single-session-assistant | 信息提取 | 回忆 assistant 提供的细节 | 中 |
| single-session-preference | 个性化 | 利用用户信息生成推荐 | 中 |
| **multi-session** | **跨会话推理** | 聚合 2-6 个 session 的信息 | **高** |
| **knowledge-update** | **知识更新** | 识别用户信息变化，用新信息覆盖旧信息 | **高** |
| **temporal-reasoning** | **时间推理** | 用时间戳和显式时间引用推理 | **高** |
| **abstention** | **弃权** | 错误前提问题，正确回答"不知道" | **极高** |

#### 实际测试用例示例

**Knowledge-update（知识更新）** — 直接测试记忆冲突处理：

```
证据1 (Session 1): "I'm using a Windows laptop"
证据2 (Session 2): "I just switched to a MacBook"
Q: What kind of computer does the user currently use?
A: MacBook
// 必须用最新信息，不能回答 "Windows laptop"
```

**Multi-session（跨会话推理）** — 跨 session 聚合信息：

```
证据1: "I've been working at the hospital for about three years"
证据2: "I left the hospital last month and joined a clinic"
Q: How long did the user work at the hospital before leaving?
A: about three years
// 需跨 session 聚合
```

**Temporal-reasoning（时间推理）** — 理解时间关系：

```
证据 (timestamp: 2024-03-15): "I'll be traveling to Japan next month"
Q (date: 2024-04-20): "Did the user mention any upcoming travel plans as of March 2024?"
A: Yes, a trip to Japan in April 2024
```

**Abstention（弃权）** — 错误前提问题：

```
证据: (对话中从未提到用户有宠物)
Q: What kind of pet do I have?
A: I don't have information about you having any pets.
// 正确做法是拒绝回答
```

#### 评估 prompt 模板

```
I will give you several history chats between you and a user.
Please answer the question based on the relevant chat history.
Answer the question step by step: first extract all the relevant
information, and then reason over the information to answer the question.

[插入完整的跨 session 聊天历史，约 115K-1.5M 字符]

Current Date: 2023/05/30 (Tue) 23:40
Question: What degree did I graduate with?
Answer (step by step):
```

#### 数据格式

每条实例包含：

```json
{
  "question_id": "e47becba",
  "question_type": "knowledge-update",
  "question": "What is my current phone number?",
  "answer": "555-9876",
  "question_date": "2023/05/30 (Tue) 23:40",
  "haystack_session_ids": ["session_id_1", "session_id_2"],
  "haystack_dates": ["2023/05/01", "2023/05/03"],
  "haystack_sessions": [[{"role": "user", "content": "..."}, ...]],
  "answer_session_ids": ["answer_280352e9"]
}
```

#### 为什么匹配 dsh-self-improving

- Knowledge-update 类型直接测试记忆更新——agent 必须识别用户信息变更并正确更新记忆
- Multi-session 类型测试跨会话信息聚合，与本项目跨会话经验注入功能对应
- 500 个问题可直接使用，数据格式标准化

---

### 2. Agent Memory Benchmark (AlekseiMarchenko) — 轻量级 56 测试套件

- **URL**: https://github.com/AlekseiMarchenko/agent-memory-benchmark
- **使用方式**: `npx agent-memory-benchmark` 一键运行
- **技术栈**: TypeScript（与本项目一致）
- **评分方式**: 二元 pass/fail，基于关键词存在，不使用 LLM-as-judge，结果可复现

#### 56 个测试覆盖 8 个类别

| 类别 | 测试数 | 测试内容 | 难度 |
|---|---|---|---|
| Factual Recall | 8 | 存储事实，直接检索 | 基础 |
| Semantic Search | 8 | 用改写/概念查询检索 | 中 |
| Temporal Reasoning | 7 | "之前/之后"和"最新"查询 | 高 |
| **Conflict Resolution** | 7 | 事实矛盾时最新应获胜 | **高** |
| **Selective Forgetting** | 6 | 已删除记忆不应重现 | **高** |
| **Cross-Session** | 7 | 跨会话上下文保持 | **高** |
| Multi-Agent | 6 | Agent A 存储，Agent B 检索 | 中 |
| Cost Efficiency | 7 | 延迟和操作计数 | 中 |

#### Layer 2 多步场景（5 个）

- 偏好组装：从多个分散记忆中组装完整用户偏好
- 上下文连续性：跨 session 保持任务上下文
- 冲突链：连续多次更新同一事实
- 跨 agent 交接：Agent A 存储的工作上下文由 Agent B 接续
- 冗余检查：重复写入不应产生冗余记忆

#### Layer 3 规模化测试

注入 1K/5K/10K 条干扰记忆后重跑 Layer 1 查询，测试规模化检索能力。

#### 实际测试用例

**Conflict Resolution — 记忆冲突解决**：

```
cr-01: 先存 "Default timeout is 30 seconds"
       后存 "Changed default timeout to 60 seconds"
       查询: "what is the default timeout"
       期望: "60 seconds" (最新值获胜)

cr-02: 先存 "Logging uses Winston"
       后存 "Replaced Winston with Pino for better performance"
       查询: "what logging library do we use"
       期望: "Pino" (最新值获胜)

cr-05: 先存 "Use Prettier with semicolons enabled"
       后存 "Team voted to disable semicolons in Prettier config"
       查询: "do we use semicolons"
       期望: "disabled"
```

**Cross-Session — 跨会话记忆**：

```
cs-05: 5 条模拟一周工作记忆:
  "Monday: set up CI/CD pipeline with GitHub Actions. Tests passing."
  "Tuesday: implemented user authentication with JWT tokens."
  "Wednesday: added rate limiting middleware. 100 req/min for free tier."
  "Thursday: deployed to staging. Found CORS issue, fixed by evening."
  "Friday: production deploy successful. Monitoring looks clean."
  查询: "summarize what happened this week"
  期望包含关键词: ["CI/CD", "authentication"]

cs-06: 任务状态追踪 (4 条记忆):
  "Task started: implement search functionality for the API"
  "Blocker found: full-text search requires pg_trgm extension not available"
  "Blocker resolved: switched to application-layer trigram matching"
  "Task completed: search functionality shipped with vector + BM25 + trigram hybrid approach"
  查询: "what happened with the search task"
  期望包含关键词: ["search", "completed"]
```

#### 为什么匹配 dsh-self-improving

- Conflict Resolution 直接对应本项目的经验去重功能（相同工具序列只保留最新一条）
- Cross-Session 对应本项目的跨会话经验注入
- TypeScript 实现，技术栈一致，适配成本最低
- `npx` 一键运行，测试用例结构简单（seed → query → expected keywords）

---

### 3. LoCoMo — 最成熟的长对话记忆基准

- **URL**: https://github.com/snap-research/locomo
- **论文**: ACL 2024, "Evaluating Very Long-Term Conversational Memory of LLM Agents" (arXiv:2402.17753)
- **数据文件**: `data/locomo10.json`（2.8MB，已验证可下载）
- **许可证**: CC BY-NC 4.0

#### 设计特点

每段对话平均 300 轮、9K tokens，跨越最多 35 个 session，时间跨度 6-12 个月。通过 LLM agent 架构结合 persona 和时间事件图生成对话，再经人工标注验证。

#### 1986 个 QA，5 个类别

| 类别 | 数量 | 难度 | 说明 |
|---|---|---|---|
| Single-hop (cat 4) | 841 | 基础 | 从单个 session 提取事实 |
| Multi-hop (cat 1) | 282 | **高** | 跨多个 session 整合信息 |
| Temporal (cat 2) | 321 | **高** | 理解事件时间顺序和日期 |
| Open-domain (cat 3) | 96 | 中 | 需要外部常识知识 |
| Adversarial (cat 5) | 446 | **极高** | 误导性前提，正确答案是"不知道" |

正式评分使用前 4 类共 1540 个问题（对抗性问题因无标准答案排除）。

#### 实际测试用例示例

从 `locomo10.json` 第一条数据（conv-26, Caroline ↔ Melanie）摘录：

```
session_1 开头:
  [Caroline] Hey Mel! Good to see you! How have you been?
  [Melanie] Hey Caroline! I'm swamped with the kids & work. What's up?
  [Caroline] I went to a LGBTQ support group yesterday and it was so powerful.

Multi-hop 示例:
  Q: When did Caroline go to the LGBTQ support group?
  A: 7 May 2023
  evidence: ['D1:3']

Temporal 示例:
  Q: What did Caroline research?
  A: Adoption agencies
  evidence: ['D2:8']

Adversarial 示例:
  Q: What did Caroline realize after her charity race?
  A: None  (正确答案是"不知道"，问题含误导前提)
  evidence: ['D2:3']
```

#### 数据结构

```json
{
  "sample_id": "conv-26",
  "conversation": {
    "speaker_a": "Caroline",
    "speaker_b": "Melanie",
    "session_1": [{"speaker": "Caroline", "dia_id": "1", "text": "..."}],
    "session_1_date_time": "2023-05-08T13:56:00Z",
    "session_2": [...]
  },
  "qa": [
    {
      "question": "What did Caroline research?",
      "answer": "Adoption agencies",
      "category": 4,
      "evidence": ["D2:8"]
    }
  ],
  "observation": {"session_1_observation": "..."},
  "session_summary": {"session_1_summary": "..."},
  "event_summary": {"events_session_1": [...]}
}
```

#### 为什么匹配 dsh-self-improving

- 35 个 session 的超长对话最能体现跨会话记忆的必要性
- Multi-hop 类别需要跨 session 拼接信息，与本项目跨会话经验注入功能对应
- Adversarial 类别测试 agent 能否识别信息缺失——即使长上下文模型也接近随机猜测水平（约 2% F1）
- 学术界使用最广泛，数据质量最高

---

## 其他已验证的基准仓库

以下仓库均验证 HTTP 200 存在，但作为备选参考：

| 仓库 | URL | 特点 |
|---|---|---|
| **BEAM** | https://github.com/mohammadtavakoli78/BEAM | 128K-10M tokens, 10 种记忆能力, 唯一覆盖矛盾解决 (Contradiction Resolution) 和事件排序 (Event Ordering), ICLR 2026 |
| **Memora** | https://github.com/geniesinc/Memora | 记忆整合(平均 28.4 sessions) + 记忆变异(平均 14.8 次更新), FAMA 指标惩罚过时信息, ACL 2026 |
| **MemBench** | https://github.com/import-myself/MemBench | 事实记忆 vs 反思记忆, 参与场景 vs 观察场景, ACL 2025 Findings |
| **EvolMem** | https://github.com/shenye7436/EvolMem | 认知心理学驱动, 7 个细粒度能力含非陈述性记忆(学习+习惯化) |
| **AMB (vectorize)** | https://github.com/vectorize-io/agent-memory-benchmark | Agentic 任务记忆, 同时追踪准确率/速度/成本, https://agentmemorybenchmark.ai |
| **supermemoryai/memorybench** | https://github.com/supermemoryai/memorybench | 可插拔框架, 支持 LoCoMo/LongMemEval/ConvoMem |
| **MemSim/MemDaily** | https://github.com/nuster1128/MemSim | 贝叶斯网络自动构造 QA, 6 种问题类型含噪声推理, NeurIPS 2025 |
| **MemoryArena** | HuggingFace `ZexueHe/memoryarena` | 记忆-行动循环, 子任务间有显式依赖(如先买相机机身后买兼容镜头), ICML 2026 |
| **MemoryAgentBench** | https://github.com/HUST-AI-HYZ/MemoryAgentBench | 增量多轮交互, 4 核心能力含冲突解决, ICLR 2026 |
| **MemoryBench (THUIR)** | https://github.com/LittleDinoC/MemoryBench-dataset | 声明性+程序性记忆, 含用户反馈循环, 20K 案例 |
| **DialSim** | 论文 arXiv:2409.... | 基于 Friends/Big Bang Theory/The Office 的角色对话记忆 |
| **Mem0** | https://github.com/mem0ai/mem0 | 记忆层框架, 在 LoCoMo 上报告 92.5 分 |
| **Letta/MemGPT** | https://github.com/letta-ai/letta | 有状态 agent 平台, 论文原创 DMR 深度记忆检索任务 |
| **Letta Evals** | https://github.com/letta-ai/letta-evals | Letta 官方评估框架, 支持 CI/CD 集成 |

---

## 难度场景对比

### 跨多轮回忆（需要记住很久之前的信息）

| 基准 | 测试内容 | URL |
|---|---|---|
| LoCoMo Multi-hop | 综合 35 个 session、300 轮对话中的信息 | https://github.com/snap-research/locomo |
| LongMemEval Multi-session | 跨 2-6 个证据 session 聚合信息，嵌入在 115K-1.5M tokens 干扰中 | https://github.com/xiaowu0162/longmemeval |
| Memora Quarterly | 记忆整合平均需 28.4 个 session，最多 309 个 | https://github.com/geniesinc/Memora |

### 记忆冲突处理（知识更新和矛盾解决）

| 基准 | 测试内容 | URL |
|---|---|---|
| LongMemEval Knowledge Update | 用户先说住在 A，后来搬到 B，agent 需识别变化 | https://github.com/xiaowu0162/longmemeval |
| BEAM Contradiction Resolution | 检测并调和相距甚远轮次间的不一致陈述 | https://github.com/mohammadtavakoli78/BEAM |
| AMB Conflict Resolution | 事实矛盾时最新值获胜 (7 个测试) | https://github.com/AlekseiMarchenko/agent-memory-benchmark |

### 对抗性/欺骗性场景

| 基准 | 测试内容 | URL |
|---|---|---|
| LoCoMo Adversarial (446 问) | 误导性前提，即使长上下文模型也接近随机猜测 | https://github.com/snap-research/locomo |
| LongMemEval Abstention (30 问) | 错误前提问题，测试是否拒绝回答 | https://github.com/xiaowu0162/longmemeval |
| BEAM Abstention | 证据缺失时拒绝回答 | https://github.com/mohammadtavakoli78/BEAM |

### 时间推理

| 基准 | 测试内容 | URL |
|---|---|---|
| LoCoMo Temporal (321 问) | 通过时间推理回答，捕获时间相关线索 | https://github.com/snap-research/locomo |
| LongMemEval Temporal Reasoning | 用元数据时间戳和显式时间引用推理 | https://github.com/xiaowu0162/longmemeval |
| BEAM Event Ordering | 识别和重建信息演变的序列顺序 | https://github.com/mohammadtavakoli78/BEAM |

---

## 综合推荐

| 优先级 | 基准 | 为什么匹配 dsh-self-improving | 适配成本 |
|---|---|---|---|
| **1** | **LongMemEval** | Knowledge-update 测试记忆更新；Multi-session 测试跨会话聚合；500 问可直接使用 | 中（需下载 HuggingFace 数据） |
| **2** | **AlekseiMarchenko/AMB** | Conflict Resolution + Cross-Session 直接对应经验去重和跨会话注入；TypeScript，`npx` 一键运行 | **低**（技术栈一致） |
| **3** | **LoCoMo** | 35 session 超长对话最能体现跨会话记忆必要性；Multi-hop + Adversarial 难度最高 | 中高（数据量大，需适配） |
