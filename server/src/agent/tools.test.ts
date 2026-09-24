import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { containerName, containers } from '../container/manager.ts';
import { validateInput, tools } from './tools.ts';
import type { ToolOutput } from '@aiw/contracts/tools';

function hasSandboxImage(): boolean {
  try {
    execFileSync('docker', ['inspect', 'aiw-sandbox:latest'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const liveSuite = hasSandboxImage() ? describe : describe.skip;

// 这些用例只走 zod 校验 / 路径前缀判断，不需要容器，始终运行
describe('agent/tools 校验（无容器）', () => {
  it('run_shell_command 正常输入通过', () => {
    const v = validateInput('run_shell_command', { command: 'ls -la', timeoutSec: 10 });
    expect(v).toEqual({ command: 'ls -la', timeoutSec: 10 });
  });

  it('run_shell_command 传 { command: {} } 抛 zod 错误', () => {
    expect(() => validateInput('run_shell_command', { command: {} })).toThrow();
  });

  it('read_file 非 /workspace 前缀被拒绝', () => {
    expect(() => validateInput('read_file', { path: '/etc/passwd' })).toThrow();
  });

  it('read_file /workspace 前缀通过', () => {
    const v = validateInput('read_file', { path: '/workspace/a.csv' });
    expect(v).toEqual({ path: '/workspace/a.csv' });
  });

  it('write_file 非 /workspace 前缀被拒绝', () => {
    expect(() => validateInput('write_file', { path: 'rel.txt' })).toThrow();
  });

  it('tools 注册表含三个工具且有 spec', () => {
    expect(Object.keys(tools).sort()).toEqual(
      ['read_file', 'run_shell_command', 'write_file'].sort(),
    );
    for (const k of Object.keys(tools)) {
      expect(tools[k as keyof typeof tools].spec.name).toBe(k);
    }
  });
});

// 这些用例真实执行命令，需要 aiw-sandbox 镜像
liveSuite('agent/tools 真实执行（需镜像）', () => {
  const convId = `test-tools-${Math.random().toString(36).slice(2, 8)}`;
  const name = containerName(convId);
  const ctx = { convId, signal: new AbortController().signal };

  it('前置：确保容器', async () => {
    await containers.ensure(convId);
    expect(await containers.inspect(convId)).toBe('running');
  });

  it('run_shell_command happy path', async () => {
    const out: ToolOutput = await tools.run_shell_command.run(
      { command: 'echo hi-from-tools' },
      ctx,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('hi-from-tools');
  });

  it('write_file + read_file 回环', async () => {
    const content = 'line1\nline2\n中文测试\n';
    const w = await tools.write_file.run(
      { path: '/workspace/tooltest.txt', content },
      ctx,
    );
    expect(w.exitCode).toBe(0);
    const r = await tools.read_file.run({ path: '/workspace/tooltest.txt' }, ctx);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('line1');
    expect(r.stdout).toContain('中文测试');
  });

  it('后置：清理容器', () => {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  });
});
