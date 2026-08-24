# dsh-ai-enhancements

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 用的两个插件：

1. **dsh-self-improving** — 跨会话学习层，agent 从历史经验中学习
2. **dsh-rule-enforcement** — 用户规则注入，编辑 markdown 文件即可控制 agent 行为

两个插件可以单独用，也可以一起用。

> English: [README.md](README.md)

---

## 前置要求

- Node.js >= 22（`node -v` 检查；`better-sqlite3@12` 提供 Node 22–24 预编译）
- dsh 已安装并配置好 LLM provider

---

## dsh-self-improving — 跨会话学习

agent 每次任务结束后自动评分、存入经验库，下次任务时把相关经验注入给 agent 参考。

### 安装到 dsh

```bash
# 1. 克隆本仓库
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving

# 2. 安装依赖并编译
pnpm install
pnpm run build

# 3. 打包成 tarball
pnpm pack    # 生成 dsh-self-improving-0.1.0.tgz

# 4. 安装到 dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /绝对路径/dsh-self-improving-0.1.0.tgz
```

安装后在 WebUI → 设置 → 插件 里可以看到和管理这个插件。

如果安装时提示 `better-sqlite3` 构建被忽略，编辑 `~/.dsh/profiles/web/pnpm-workspace.yaml` 加入：

```yaml
allowBuilds:
  better-sqlite3: true
```

然后重新安装：

```bash
dsh plugin --profile web remove dsh-self-improving
dsh plugin --profile web add /绝对路径/dsh-self-improving-0.1.0.tgz
```

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
[self-improving] turn 1 scored — score=0.78
```

再跑第二个任务，会看到经验注入：
```
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
```

### 本地开发测试

```bash
cd dsh-self-improving
pnpm install          # 安装依赖
pnpm test             # 跑 29 个单元测试
pnpm run benchmark    # 跑模拟 A/B benchmark，生成 benchmark-report.html
```

---

## dsh-rule-enforcement — 用户规则注入

编辑 `~/.dsh/rules.md` 写入规则，规则会自动注入到 agent 的系统提示词中。改了文件立即生效，不用重启。

### 安装到 dsh

```bash
# 1. 克隆本仓库
git clone https://github.com/aminuoshi-378/dsh-self-improving.git
cd dsh-self-improving/dsh-rule-enforcement

# 2. 安装依赖并编译
pnpm install
pnpm run build

# 3. 打包成 tarball
pnpm pack    # 生成 dsh-rule-enforcement-0.1.4.tgz

# 4. 安装到 dsh
cd /path/to/deepseek-harness
dsh plugin --profile web add /绝对路径/dsh-rule-enforcement-0.1.4.tgz
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

## 两个插件一起装

```bash
cd /path/to/deepseek-harness

dsh plugin --profile web add /绝对路径/dsh-self-improving-0.1.0.tgz
dsh plugin --profile web add /绝对路径/dsh-rule-enforcement-0.1.4.tgz

dsh --profile web
```

两个插件互不干扰，在 WebUI 插件列表里可以独立启用/禁用。

---

## 常见问题

**安装时 `better-sqlite3` 报错（如 `ECONNRESET`、`gyp ERR! find VS`）？**
通常两个原因：
- `better-sqlite3` 默认从 GitHub 下载预编译二进制，可能无法访问。本项目自带 `.npmrc`，把 `prebuild-install` 指向 npmmirror 镜像，正常 `pnpm install / pnpm run build` 即可。若删除了 `.npmrc`，恢复它或手动设置 `better_sqlite3_binary_host=https://registry.npmmirror.com/-/binary`。
- 旧版 `better-sqlite3@11` 没有 Node 24 的预编译，会回退到本地 `node-gyp` 编译（需要 VS C++ 工具链）。本项目锁定 `better-sqlite3@^12`，带 Node 24 预编译，请保留锁定版本，不要降回 v11。

**插件没出现在 WebUI 插件列表？**
插件必须通过 `dsh plugin add <tarball>` 安装才会出现在 WebUI 里。workspace 方式（`link:`）不会显示。

**`dbPath` 报目录不存在？**
插件会自动创建 `~/.dsh/` 目录。如果还是报错，手动执行 `mkdir -p ~/.dsh`。

**tarball 安装时报 type stripping 错误？**
打包前必须先 `pnpm run build` 编译 `.ts` → `.js`，确保 `dist/` 目录存在。

**`duplicate loader entry id`？**
同一个插件被加载了两次。确保 dsh 仓库 `packages/` 目录下没有同名插件，或者其 `package.json` 没有 `dsh` 字段。

---

## 更多文档

- [架构设计](docs/design.md) — 四层架构详解、安全边界、实施路径
- [插件开发笔记](docs/plugin-dev-notes.md) — dsh 插件开发实践要点和陷阱
- [变更日志](CHANGELOG.md)
