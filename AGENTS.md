# AGENTS.md

项目规范与约定，所有 AI agent 和开发者都应遵守。

---

## README 文档规范

1. **中英文同步**：修改 README 时必须同时修改 `README.md`（英文）和 `README.zh-CN.md`（中文），两者内容保持一致。

2. **面向用户**：README 是给用户快速上手的文档，不是原理介绍。每个步骤写清楚：
   - 在哪个目录执行
   - 跑什么命令
   - 预期看到什么输出

3. **安装步骤从本仓库出发**：这是 dsh 插件仓库，最终结果是接入 dsh 运行。安装流程为：
   - `git clone` 本仓库
   - `pnpm install` + `pnpm run build` 编译
   - `pnpm pack` 打包成 tarball
   - `dsh plugin --profile web add <tarball>` 安装到 dsh
   - 不要引用 dsh 仓库内的路径（用户不一定有）

4. **命令必须用 pnpm**：dsh 生态用 pnpm，不要用 npm。

5. **命令必须验证可跑**：写进 README 的每条命令都必须实际跑过确认能执行，不能出现低级错误。

6. **挂载配置写明文件路径**：如果需要用户编辑配置文件，必须写清楚是哪个文件（如 `~/.dsh/profiles/web/cordis.patch.yml`），不能只写一段 YAML 让用户猜放哪。

---

## 通用开发规范

1. **Node 版本**：Node.js >= 22，用 `nvm use 22` 切换。

2. **不要用 Bash 工具启动 dsh web**：`dsh --profile web` 是持续运行的服务进程不会退出，会导致 AI agent 的 Bash 工具阻塞。启动命令交给用户手动执行，agent 只做安装、配置、验证等会退出的操作。

3. **打包前必须编译**：Node 22 不支持从 `node_modules` 里的 `.ts` 文件做 type stripping。打包前必须 `pnpm run build` 编译成 `dist/`（纯 JS），`package.json` 的 `main` 指向 `dist/index.js`，`files` 包含 `dist`。

4. **`~` 路径不自动展开**：代码里 `~/.dsh/xxx` 传给 better-sqlite3 等库时 `~` 不会被展开，需要手动 `replace('~/', process.env.HOME + '/')`。

5. **`better-sqlite3` 需要 `allowBuilds`**：在 `pnpm-workspace.yaml` 里加 `allowBuilds: { better-sqlite3: true }`，否则 pnpm 会跳过原生编译。

6. **link 与 tarball 都能被 WebUI 管理**：通过 `dsh plugin add <tarball>` 或 `link:` workspace 方式安装的插件都会出现在 WebUI 插件列表里，前提是在 profile 的 `package.json` 里声明依赖并注册到 `dsh.profile.bundles`。

7. **避免 bundle id 冲突**：同一个插件如果既在 dsh 仓库 `packages/` 目录又通过 tarball 安装，会报 `duplicate loader entry id`。解决：workspace 包的 `package.json` 不要 `dsh` 字段。

8. **提交前验证**：`pnpm test` 和 `pnpm run build` 都跑过确认通过再提交。
