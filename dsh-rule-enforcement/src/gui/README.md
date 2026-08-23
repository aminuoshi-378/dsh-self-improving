# dsh-rule-enforcement-gui (WebUI Rules 编辑面板)

在 dsh Web Settings 贡献一个 **Rules** 标签页，编辑**一段软规则文本**（markdown），存入后端 `dsh-rule-enforcement` 的 settings namespace 并作为建议注入 agent 系统提示词。

构建已实测通过，产物为 `lib/client.js` + `lib/index.mjs`。

## 构建 + 安装（PowerShell）

```powershell
cd dsh-rule-enforcement/src/gui
pnpm install
pnpm run build; pnpm run bundle   # 构建 → lib/client.js
pnpm pack                          # → dsh-rule-enforcement-gui-0.1.1.tgz
dsh plugin --profile web add D:\绝对路径\dsh-rule-enforcement-gui-0.1.1.tgz
```

## 说明

- tarball 用**绝对路径**
- GUI 是浏览器端插件，只在含 `dsh-web-app` 的 profile（即 `web`）生效
- 零改 dsh 源码：独立 npm bundle 包，`dsh plugin add` 自动登记进 `dsh.profile.bundles`
- `pnpm install` 报 `esbuild` 时，加 `pnpm-workspace.yaml`：`allowBuilds: { esbuild: true }`

## 验证

```powershell
dsh web   # → Settings → Plugins → Rules 标签页，编辑文本保存
```