# dsh-self-improving-gui

WebUI 经验库可视化面板，安装后在 dsh Web 设置 → 插件 → Experiences 中查看。

## 构建

```bash
pnpm install
pnpm run build     # 编译 TypeScript 类型
pnpm run bundle     # 打包浏览器 bundle
pnpm pack           # 生成 tarball
```

## 安装到 dsh

```bash
dsh plugin --profile web add /absolute/path/to/dsh-self-improving-gui-0.1.0.tgz
```

安装后重启 dsh web。

## 功能

- 统计展示：总数、平均分、含 lesson 数、正/负反馈、高难度数、新生代/老年代数
- 导出：一键导出全量经验为 JSON 文件
- 导入：上传 JSON 文件导入经验，按 id 去重
