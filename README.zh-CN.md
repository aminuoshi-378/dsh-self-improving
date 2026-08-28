# dsh-ai-enhancements

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 用的两个插件：

1. **dsh-self-improving** — 跨会话学习层，agent 从历史经验中学习
2. **dsh-rule-enforcement** — 用户规则注入，编辑 markdown 文件即可控制 agent 行为

两个插件可以单独用，也可以一起用。

> English: [README.md](README.md)
> 中文: [README.zh-CN.md](README.zh-CN.md)

---

## 前置要求

- Node.js >= 22（`node -v` 检查）
- dsh 已安装并配置好 LLM provider

---

## dsh-self-improving — 跨会话学习

agent 每次任务结束后自动评分、存入经验库，下次任务时把相关经验注入给 agent 参考。

### 安装到 dsh

#### 方式一：tarball 安装（懒人专属，一键安装）

适合正式使用。安装后在 WebUI → 设置 → 插件 里可见可管理。

```bash
# 1. 克隆并构建
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving
pnpm install
pnpm run build

# 2. 打包成 tarball
pnpm pack    # 生成 dsh-self-improving-0.1.0.tgz

# 3. 安装到 dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /绝对路径/dsh-self-improving-0.1.0.tgz
```

> ⚠️ 仓库更新后需要重新 `pnpm run build && pnpm pack` 并重新安装 tarball 才能生效。

#### 方式二：link 安装（便于开发）

适合开发调试。改完代码只需 `pnpm run build` + 重新 install 即可生效，不用每次打包。

```bash
# 1. 克隆并构建
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving
pnpm install
pnpm run build

# 2. 修改 dsh web profile 的 package.json，把依赖从 tarball 切到 link：
#    编辑 ~/.dsh/profiles/web/package.json，找到 "dsh-self-improving" 那行，改为：
#    "dsh-self-improving": "link:/绝对路径/dsh-self-improving"

# 3. 重新安装依赖（允许更新 lockfile）
cd ~/.dsh/profiles/web
CI=true pnpm install --no-frozen-lockfile
```

> ℹ️ link 方式安装的插件同样会出现在 WebUI 插件列表里。

> 💡 开发流程：改代码 → `pnpm run build` → `cd ~/.dsh/profiles/web && CI=true pnpm install --no-frozen-lockfile` → 重启 dsh web

### 验证

```bash
cd /path/to/deepseek-harness

# 跑第一个任务（积累经验）
dsh --profile web "create a file called hello.js"
```

stderr 会输出：
```
[self-improving] plugin loaded
[self-improving] tool/result — write OK
[self-improving] turn 1 scored — score=0.78 | goal=advanced tools=1 successRate=1.00 steps=1 efficiency=1.00 difficulty=low
```

再跑第二个任务，会看到经验注入（P0: 每个 turn 只注入一次）：
```
[self-improving] agent/pre-step — turn=2 step=1 (injecting)
[self-improving] injecting 1 past experiences into pre-step (best score 0.78)
```

### 配置

安装后默认配置已经可用。如需修改，在 `~/.dsh/profiles/web/cordis.patch.yml` 里覆盖：

```yaml
- id: self-improving
  config:
    dbPath: '~/.dsh/experiences.db'    # 经验库路径，必须用文件路径才能跨会话
    metaCognitionEnabled: true        # 是否开启反思（提取经验教训）
    behaviorAdapterEnabled: true       # 是否开启经验注入
    minInjectionScore: 0.3             # 只注入评分 >= 0.3 的经验
    # 经验注入预算
    maxInjectionChars: 8000            # 每 turn 注入 lesson 文本的最大字符数
    # 元认知反思队列
    maxPendingReflections: 100         # 反思队列上限，超出时丢弃最旧条目
    # 经验库分代 GC 上限
    youngGenMax: 200                   # 新生代最大记录数
    oldGenMax: 800                     # 老年代最大记录数
    lessonMergeThreshold: 20           # 未合并 lesson 数达到该值时触发合并
    experienceTtlDays: 30              # 老年代经验 N 天未注入则降级到新生代
    forgetScoreThreshold: 0.3          # 主动遗忘分数阈值
    forgetConfidenceThreshold: 0.2     # 主动遗忘置信度阈值
    # Phase 6 自适应策略（可选，默认关闭）
    adaptiveModelEnabled: false        # 是否开启按任务类型历史成功率切换模型
    strongModel: ''                    # 强推理模型 id（如 deepseek-reasoner），为空则不切换
    standardModel: ''                  # 标准模型 id（如 deepseek-chat）
    adaptiveToolGuardEnabled: false    # 是否开启基于历史失败的工具拦截
    failedToolDenyThreshold: 3         # 工具在 N 个失败经验中出现则拦截
```

#### 内置行为（无需配置，自动生效）

- 相同工具序列的经验自动去重，保留最新一条。
- 每个 turn 只在第一步注入一次经验。
- 按步数效率和任务难度评分。
- 自动识别隐式负反馈（用户中断、纠正、重述任务）。
- 自动合并相似 lesson 并做分代 GC。
- 自动推断任务类型以提升匹配准确率。
- 可选的自适应模型切换和工具拦截（见上方 Phase 6 配置）。

实现细节见 [docs/design.md](docs/design.md)。

### 安装 WebUI 经验库面板（可选）

```bash
cd dsh-self-improving/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # 生成 dsh-self-improving-gui-0.1.0.tgz
dsh plugin --profile web add /绝对路径/dsh-self-improving-gui-0.1.0.tgz
```

安装后重启 dsh web，在 设置 → 插件 → Experiences 里查看经验库统计和导入/导出。

> link 方式：在 `~/.dsh/profiles/web/package.json` 里加 `"dsh-self-improving-gui": "link:/绝对路径/dsh-self-improving/gui"`，然后 `cd ~/.dsh/profiles/web && CI=true pnpm install --no-frozen-lockfile`。

### 本地开发测试

```bash
cd dsh-self-improving
pnpm install          # 安装依赖
pnpm test             # 跑 109 个单元测试（8 个测试文件）
pnpm run benchmark    # 跑模拟 A/B benchmark，生成 benchmark-report.html
```

单独跑某个测试文件：

```bash
pnpm run test:store      # 经验库（14 个）
pnpm run test:evaluator  # 结果评分器（8 个）
pnpm run test:adapter    # 行为适配器（11 个）
pnpm run test:meta       # 元认知引擎（11 个）
pnpm run test:memory     # 记忆能力 benchmark（15 个）
pnpm run test:advanced   # 高级特性 A1-B2 + T4（30 个）
pnpm run test:adaptive   # 自适应策略 Phase 6（11 个）
pnpm run test:event      # 事件解析兼容性（9 个）
```

---

## dsh-rule-enforcement — 用户规则注入

编辑 `~/.dsh/rules.md` 写入规则，规则会自动注入到 agent 的系统提示词中。改了文件立即生效，不用重启。

### 安装到 dsh

#### 方式一：tarball 安装（懒人专属，一键安装）

```bash
# 1. 克隆并构建
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build
pnpm pack    # 生成 dsh-rule-enforcement-0.1.4.tgz

# 2. 安装到 dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /绝对路径/dsh-rule-enforcement-0.1.4.tgz
```

#### 方式二：link 安装（便于开发）

```bash
# 1. 克隆并构建
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement
pnpm install
pnpm run build

# 2. 修改 ~/.dsh/profiles/web/package.json，改为：
#    "dsh-rule-enforcement": "link:/绝对路径/dsh-self-improving/dsh-rule-enforcement"

# 3. 重新安装依赖（允许更新 lockfile）
cd ~/.dsh/profiles/web
CI=true pnpm install --no-frozen-lockfile
```

### 安装 WebUI 编辑面板（可选）

```bash
cd dsh-rule-enforcement/src/gui
pnpm install
pnpm run build
pnpm run bundle
pnpm pack    # 生成 dsh-rule-enforcement-gui-0.1.3.tgz
dsh plugin --profile web add /绝对路径/dsh-rule-enforcement-gui-0.1.3.tgz
```

安装后重启 dsh web，在 设置 → 插件 → Rules 里编辑规则。

### 编辑规则

直接编辑文件 `~/.dsh/rules.md`：

```markdown
# 项目规则

- 用户用中文提问时用中文回复
- 提交前先更新 CHANGELOG
- 新文件用 TypeScript
- git push 之前先进行安全检查
```

或通过 WebUI 编辑。改完保存即可，下次 agent 请求时自动生效。

### 本地开发测试

```bash
cd dsh-rule-enforcement
pnpm install
pnpm run typecheck    # 类型检查
pnpm test             # 跑 10 个测试
```

---

## 全部一起装

### tarball 方式

```bash
cd /path/to/deepseek-harness
dsh plugin --profile web add /绝对路径/dsh-self-improving-0.1.0.tgz
dsh plugin --profile web add /绝对路径/dsh-self-improving-gui-0.1.0.tgz
dsh plugin --profile web add /绝对路径/dsh-rule-enforcement-0.1.4.tgz
dsh plugin --profile web add /绝对路径/dsh-rule-enforcement-gui-0.1.3.tgz
dsh --profile web
```

### link 方式

编辑 `~/.dsh/profiles/web/package.json`：

```json
{
  "dependencies": {
    "dsh-self-improving": "link:/path/to/dsh-self-improving",
    "dsh-self-improving-gui": "link:/path/to/dsh-self-improving/gui",
    "dsh-rule-enforcement": "link:/path/to/dsh-self-improving/dsh-rule-enforcement",
    "dsh-rule-enforcement-gui": "link:/path/to/dsh-self-improving/dsh-rule-enforcement/src/gui"
  }
}
```

```bash
cd ~/.dsh/profiles/web
CI=true pnpm install --no-frozen-lockfile
dsh --profile web
```

---

## 常见问题

**安装时 `better-sqlite3` 报错？**
在 `~/.dsh/profiles/web/pnpm-workspace.yaml` 里加 `allowBuilds: { better-sqlite3: true }`，重装。

**插件没出现在 WebUI 插件列表？**
确保插件已在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 里声明（link 或 tarball 均可），并在 `dsh.profile.bundles` 里注册，然后重启 dsh web。

**`dbPath` 报目录不存在？**
插件会自动展开 `~` 并创建目录。如果还是报错，手动执行 `mkdir -p ~/.dsh`。

**tarball 安装时报 type stripping 错误？**
打包前必须先 `pnpm run build` 编译 `.ts` → `.js`，确保 `dist/` 目录存在。

**`duplicate loader entry id`？**
同一个插件被加载了两次。确保 dsh 仓库 `packages/` 目录下没有同名插件，或者其 `package.json` 没有 `dsh` 字段。

**link 方式改了代码不生效？**
改完代码后需要重新编译：`pnpm run build`，然后在 profile 目录重新安装：`cd ~/.dsh/profiles/web && CI=true pnpm install --no-frozen-lockfile`。

---

## 更多文档

- [架构设计](docs/design.md) — 四层架构详解、P0-P5 实现细节、安全边界、实施路径
- [待办事项](todo.md) — P0-P5 完成情况与后续计划
- [变更日志](CHANGELOG.md)
