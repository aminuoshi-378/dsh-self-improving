/**
 * Ambient type declarations for dsh runtime packages.
 *
 * These packages are installed as optional peerDependencies — they exist in
 * the dsh runtime environment but not in this repo's node_modules during
 * standalone compilation. All imports in src/index.ts use `import type`, so
 * these declarations are erased at emit time and the emitted JS has zero
 * runtime references to them.
 *
 * In the dsh runtime (where the real packages are installed), the real type
 * definitions take precedence over these stubs because pnpm resolves the
 * actual packages first.
 */

declare module '@deepseek-ai/cordis' {
  export interface Context {
    on(event: string, handler: (...args: any[]) => any): void
    get<T = any>(service: string): T | undefined
    systemPrompt: {
      section(opts: { name: string; order: number; text: () => string }): void
    }
    effect(fn: () => (() => void)): void
  }
}

declare module '@deepseek-ai/dsh-agent' {
  export interface Agent {
    id: string
    session: {
      id: string
      events: any[]
    }
    options: {
      cwd?: string
      provider?: string
      model?: string
      maxTokens?: number
    }
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolExecution {
    agent: import('@deepseek-ai/dsh-agent').Agent
    name: string
  }
  export interface ToolExecutionResult {
    isError: boolean
    error?: string
  }
}

declare module '@deepseek-ai/dsh-llm' {
  export interface MessageSource {
    kind: string
    plugin?: string
    form?: string
    summary?: string
  }
  export interface UserMessage {
    content?: string | any[]
    text?: string
  }
  export function createUserMessage(opts: {
    content: any[]
    source: MessageSource
  }): any
}
