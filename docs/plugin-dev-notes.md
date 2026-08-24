# DeepSeek Harness 插件开发注意事项

基于 deepseek-harness 代码库总结的实践要点。适用于给 dsh 编写第三方插件时参考。

---

## 1. 插件的基本形态

### 三种写法

```ts
// 1. 函数形式（最常用）
import type { Context } from '@deepseek-ai/cordis'
export const name = 'my-plugin'
export function apply(ctx: Context) {
  // 注册能力
}

// 2. 对象形式
export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) { /* ... */ },
}

// 3. Service 类形式（需要对外提供服务时用）
import { Service, type Context } from '@deepseek-ai/cordis'
export default class MyService extends Service {
  static inject = ['tools']
  constructor(ctx: Context) { super(ctx, 'myService') }
}
```

**建议**：在不需要对外提供服务之前，一直用函数形式。

### name 是显示元数据，不是唯一标识

`name` 用于诊断信息中标识插件。真正的唯一标识是 `cordis.yml` 中的 `id`。

---

## 2. 依赖声明 — 最常见的"插件不生效"原因

### inject 是硬依赖

```ts
export const inject = ['tools']
```

Cordis 会让你的插件保持 **PENDING** 状态，直到 `tools` 服务就绪。如果 `tools` 永远不出现，你的插件**永远不会加载，也不会报错**。

**排查方法**：遍历 `ctx.registry`，检查哪些 fiber 处于 `PENDING` 状态。

### 可选依赖用 ctx.get()

```ts
export function apply(ctx: Context) {
  const greeter = ctx.get('greeter')  // 没有提供方时返回 undefined
  if (greeter) {
    console.log(greeter.greet('world'))
  }
}
```

### 依赖关系决定加载顺序，不是配置文件顺序

你在 `cordis.yml` 里把消费方写在提供方前面也没关系。Cordis 会自动等提供方加载后再启动消费方。

### 运行期间依赖也会跟踪

如果 `inject` 声明的服务在运行期间消失（提供方被卸载），你的插件也会自动卸载，服务恢复后重新加载。

---

## 3. Effect 和自动清理

### 已是 effect 的操作（不需要手动清理）

| 操作 | 自动清理行为 |
|---|---|
| `ctx.on(event, listener)` | 监听器在卸载时移除 |
| `ctx.plugin(child)` | 子插件随父插件一同 dispose |
| `ctx.tools.register(...)` | 工具在卸载时注销 |
| 服务注册 | 卸载提供方时移除服务 |

### 需要手动包装在 ctx.effect() 中的资源

定时器、网络连接、文件 watcher 等 Cordis 不管理的资源：

```ts
export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => clearInterval(timer)  // 卸载时运行
  })
}
```

### disposer 执行顺序

- 按**注册的逆序**启动
- 多个**异步** disposer 会**并发**运行
- 如果需要顺序执行，放在同一个 disposer 中依次 `await`

---

## 4. 事件系统

### 五种分发模式

| 模式 | 调用 | 语义 |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 同步广播，不等返回值 |
| parallel | `await ctx.parallel(name, ...args)` | 所有监听器并发运行并等待 |
| serial | `await ctx.serial(name, ...args)` | 顺序运行，第一个非空返回值胜出并停止 |
| bail | `ctx.bail(name, ...args)` | serial 的同步版 |
| waterfall | `ctx.waterfall(name, ...args, next)` | 环绕中间件，可转换或短路 |

### waterfall 的纪律

**只负责观察或标注的 waterfall 监听器必须调用 `next()`**。不调用就直接返回代表有意短路。如果日志监听器忘记调用 `next()`，会悄无声息地吞掉所有下游的默认行为。

### 事件类型声明

通过 TypeScript 声明合并为事件添加类型：

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-namespace/action'(foo: string, bar: number): void
  }
}
```

命名约定：`namespace/action`，保持扁平命名空间易读。

---

## 5. 工具注册

### defineTool 是第一方工具的推荐方式

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'greet',
  description: 'Greet the named person.',
  parameters: {
    name: { type: 'string', required: true, description: 'Who to greet' },
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return `Hello, ${args.name}!`
  },
}))
```

### 工具执行流水线

模型调用工具时经过以下事件链：

```
tools/pre-execute → tools/execute → tools/post-execute → tools/result
```

| 事件 | 模式 | 用途 |
|---|---|---|
| `tools/pre-execute` | waterfall | 策略拦截：允许/拒绝/询问 |
| `tools/execute` | waterfall | 包裹分发：超时/重试/指标 |
| `tools/post-execute` | waterfall | 结果变换：接受/替换/丰富/阻止 |
| `tools/result` | emit | 观察不可变最终结果 |

**选择规则**：只观察用 `tools/result`；需要变换结果用 `tools/post-execute`；需要包裹执行用 `tools/execute`；需要策略裁决用 `tools/pre-execute`。

### 注销是自动的

`ctx.tools.register(...)` 返回的 disposer 附着到调用插件。插件卸载时，工具自动注销。

---

## 6. 系统提示词

### 注册 section

```ts
ctx.systemPrompt.section({
  id: 'my-section',
  title: 'My Plugin Instructions',
  content: 'Always do X when Y.',
  order: 500,  // 排序权重
})
```

### 注册动态上下文

```ts
ctx.systemPrompt.context({
  id: 'my-context',
  provider: () => `Current time: ${new Date().toISOString()}`,
})
```

### 系统提示是可组合的

后注册的 section 可以覆盖同 id 的前一个。用户可以在 profile 的 `cordis.patch.yml` 中覆盖你的 section，无需改你的包。

---

## 7. 插件配置

### 导出 Config schema

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  greeting: string
  maxRetries: number
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)
}
```

### 原则

- **凡是不同部署可能需要采用不同值的参数，都必须定义为配置字段**。不要硬编码。
- **在 schema 中表达完备的约束**，使无效配置在加载时失败。配置错误要响亮。
- 不要导出普通对象作为 `Config`，它不满足 Standard Schema 接口。

### HMR

修改 `cordis.yml` 中的 `config` 会触发插件热替换：卸载旧实例，加载新实例。所有注册自动清理，不会保留旧实例的状态。

---

## 8. 打包与分发

### bundle 的 package.json

```json
{
  "name": "dsh-my-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

### cordis.patch.yml

```yaml
- insert:
    - id: my-plugin
      name: dsh-my-plugin
```

插件行用**包名**引用，Node 模块解析会找到已安装的代码。

### 从 GitHub 安装的特殊处理

git 安装拉取的是**源码不是构建产物**。作者必须提供 `prepare` 脚本，用户必须授权构建：

```yaml
# pnpm-workspace.yaml
allowBuilds:
  dsh-my-plugin: true
```

如果不想让用户做这项授权，就发布到 npm（预构建）或交付 tarball。

---

## 9. 常见陷阱

### 插件一直不加载（PENDING）

**原因**：`inject` 声明了无人提供的服务。
**排查**：遍历 `ctx.registry`，检查 PENDING fiber。
**修复**：确保组合中包含该服务的提供方，或改用 `ctx.get()` 做可选依赖。

### 模块解析失败（静默失败）

**原因**：`cordis.yml` 中的 `name` 拼错或路径不对。
**表现**：通过 logger 报告错误，进程不崩溃，但插件永远不会加载。在启动阶段，这条报告可能在 console 导出器开始观察之前丢失。
**修复**：检查拼写。

### apply 抛异常（进程崩溃）

**表现**：插件加载失败会明确报错，不会静默跳过。
**修复**：在 `apply` 中做防御性编程，或用 `inject` 确保依赖就绪。

### waterfall 监听器吞掉了下游行为

**原因**：观察型监听器忘记调用 `next()`。
**修复**：除非有意短路，否则**必须**调用 `next()`。

### 动态插件不持久化

**设计决定**：`cordis_define` / `cordis_run` 挂载的动态插件是进程内存对象。重启后消失，不修改 `cordis.yml`，不安装包。
**影响**：如果你想让 agent 创建的能力跨会话保留，不能依赖动态插件，需要走正常的 bundle 安装流程或写入持久化存储。

---

## 10. 依赖规范

**扩展插件只依赖 Service Definition，永远不依赖具体 Provider。**

```
✅ import from '@deepseek-ai/dsh-tools'    (Service Definition)
❌ import from '@deepseek-ai/dsh-bash-local' (具体 Provider)
```

这保证了你可以替换提供方而不需要修改消费方。例如把 `shell` 从本地实现切换到远程沙箱，所有注入 `'shell'` 的插件自动重新启动并使用新实现。

---

## 11. 服务命名

- 服务名共用一个**扁平命名空间**。
- dsh 已占用 `tools`、`llm`、`agents`、`sessions`、`shell`、`fs`、`sandbox`、`compaction`、`systemPrompt` 等普通名称。
- 第三方插件应加**有辨识度的前缀或命名空间**（如 `myOrg:myService`）。
- 单数 `ctx` key 用于 engine/runtime/policy/store 等单个实例；复数 key 用于 registry 多成员服务。

---

## 12. 调试技巧

### 查看实际加载的插件树

```sh
dsh --profile <name> --dump-config
```

任何行都可以被你自己的 patch 覆盖。

### 检查 fiber 状态

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) {
          console.log(`${fiber.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
```

### 热重载

安装 `@deepseek-ai/cordis-plugin-hmr` 插件，保存文件时自动卸载旧实例、加载新代码。编辑 `cordis.yml` 也会触发更新（loader 按 `id` 比较配置项，只更新变化的部分）。

---

## 13. AI Agent 开发注意事项

### 不要用工具直接启动 dsh web

`dsh --profile web` 是**持续运行的服务进程**，不会退出——一直监听端口等待请求。

在 AI Agent（如 CodeFuse）的 Bash 工具中直接运行 `dsh --profile web` 会导致：
- Bash 工具阻塞在持续输出的进程上，最终超时
- 即使用 `run_in_background` + `sleep N`，不退出的服务进程仍会让工具处于"运行中"状态

**正确做法**：
- 启动命令（`dsh --profile web`、`dsh --profile web --no-open`）交给**用户手动执行**
- AI Agent 只做安装（`dsh plugin add`）、配置（`cordis.patch.yml`）、验证（`--dump-config`）等**会退出的操作**
- 验证插件是否正常加载用 `dsh --profile benchmark "say hello"`（headless 模式会退出）

### 插件打包注意事项

1. **不能直接打包 `.ts` 源码**：Node 22 不支持从 `node_modules` 里的 `.ts` 文件做 type stripping。必须先编译成 `dist/index.js`（纯 JS），`package.json` 的 `main` 指向 `dist/index.js`，`files` 包含 `dist`。

2. **`workspace:*` 依赖不能打包进 tarball**：pnpm 解析 `workspace:*` 时在 profile 目录下找不到对应路径。改用 `peerDependencies` + `peerDependenciesMeta: { optional: true }`，让 dsh 运行时提供这些包。

3. **避免 bundle id 冲突**：如果同一个插件既存在于 dsh 仓库的 `packages/` 目录（workspace 包）又通过 tarball 安装到 profile，两者的 `cordis.patch.yml` 都会 `insert` 同一个 `id`，导致 `duplicate loader entry id` 错误。解决：workspace 包的 `package.json` 不要 `dsh.bundle` 字段，只让 tarball 版本作为 bundle 加载。

4. **`~` 路径不自动展开**：`dbPath: '~/.dsh/experiences.db'` 传给 better-sqlite3 时 `~` 不会被展开。需要在代码里手动 `replace('~/', process.env.HOME + '/')`。

5. **`better-sqlite3` 需要 `allowBuilds`**：在 profile 的 `pnpm-workspace.yaml` 里加 `allowBuilds: { better-sqlite3: true }`，否则 pnpm 会跳过原生编译。
