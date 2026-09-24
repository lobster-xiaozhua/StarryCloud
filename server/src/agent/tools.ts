import { z } from 'zod';
import type { ToolName, ToolOutput, ToolSpec } from '@aiw/contracts/tools';
import { execInContainer } from '../container/exec.ts';

export interface ToolCtx {
  convId: string;
  signal: AbortSignal;
}

export type ToolFn = (input: unknown, ctx: ToolCtx) => Promise<ToolOutput>;

const runShellSchema = z.object({
  command: z.string().min(1),
  timeoutSec: z.number().int().positive().max(3600).optional(),
});

// 路径强制 /workspace/ 前缀，杜绝越权读写宿主机文件
const readFileSchema = z.object({
  path: z.string().startsWith('/workspace/'),
  maxBytes: z.number().int().positive().max(10 * 1024 * 1024).optional(),
});

const writeFileSchema = z.object({
  path: z.string().startsWith('/workspace/'),
  content: z.string(),
});

// 单引号安全转义，避免路径/内容注入到 bash -c
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function validateInput(name: ToolName, raw: unknown): unknown {
  switch (name) {
    case 'run_shell_command':
      return runShellSchema.parse(raw);
    case 'read_file':
      return readFileSchema.parse(raw);
    case 'write_file':
      return writeFileSchema.parse(raw);
    default: {
      const _exhaustive: never = name;
      throw new Error(`未知工具: ${String(_exhaustive)}`);
    }
  }
}

export const tools: Record<ToolName, { spec: ToolSpec; run: ToolFn }> = {
  run_shell_command: {
    spec: {
      name: 'run_shell_command',
      description: '在隔离容器的 /workspace 下执行一条 shell 命令，返回退出码、stdout、stderr。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          timeoutSec: { type: 'integer', description: '超时秒数，默认 300，最大 3600' },
        },
        required: ['command'],
      },
    },
    run: async (input, ctx) => {
      const { command, timeoutSec } = validateInput('run_shell_command', input) as {
        command: string;
        timeoutSec?: number;
      };
      return execInContainer(ctx.convId, command, {
        timeoutSec,
        signal: ctx.signal,
      });
    },
  },

  read_file: {
    spec: {
      name: 'read_file',
      description: '读取容器内 /workspace 下的文件（最多 maxBytes 字节，超出按 head -c 截断）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件绝对路径，必须以 /workspace/ 开头' },
          maxBytes: { type: 'integer', description: '最多读取字节数，默认 64KB' },
        },
        required: ['path'],
      },
    },
    run: async (input, ctx) => {
      const { path, maxBytes } = validateInput('read_file', input) as {
        path: string;
        maxBytes?: number;
      };
      const max = maxBytes ?? 64 * 1024;
      // 用 head -c 实现截断，避免一次读入超大文件
      return execInContainer(ctx.convId, `head -c ${max} ${shellQuote(path)}`, {
        signal: ctx.signal,
      });
    },
  },

  write_file: {
    spec: {
      name: 'write_file',
      description: '将内容以 base64 解码后写入容器 /workspace 下的文件（路径必须以 /workspace/ 开头）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件绝对路径，必须以 /workspace/ 开头' },
          content: { type: 'string', description: '要写入的文本（按 UTF-8 处理）' },
        },
        required: ['path', 'content'],
      },
    },
    run: async (input, ctx) => {
      const { path, content } = validateInput('write_file', input) as {
        path: string;
        content: string;
      };
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      // base64 仅含 A-Za-z0-9+/=，单引号包裹安全；解码后写入
      const cmd = `printf '%s' ${shellQuote(b64)} | base64 -d > ${shellQuote(path)}`;
      return execInContainer(ctx.convId, cmd, { signal: ctx.signal });
    },
  },
};

export function allToolSpecs(): ToolSpec[] {
  return Object.values(tools).map((t) => t.spec);
}
