import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { containerName, containers } from './manager.ts';
import { execInContainer } from './exec.ts';
import { dockerSuite } from './docker-guard.ts';

// 沙箱内无法 build aiw-sandbox 镜像。
// 镜像缺失时：默认打印 [SKIP] 并整组跳过；AIW_REQUIRE_DOCKER=1 时改为失败，强制真跑。
const suite = dockerSuite('container/exec');

suite('container/exec', () => {
  const convId = `test-exec-${Math.random().toString(36).slice(2, 8)}`;
  const name = containerName(convId);

  it('前置：确保容器存在', async () => {
    await containers.ensure(convId);
    const st = await containers.inspect(convId);
    expect(st).toBe('running');
  });

  it('echo hello -> exitCode 0 + stdout', async () => {
    const o = await execInContainer(convId, 'echo hello');
    expect(o.exitCode).toBe(0);
    expect(o.stdout.trim()).toBe('hello');
    expect(o.aborted).toBe(false);
  });

  it('exit 3 -> exitCode 3', async () => {
    const o = await execInContainer(convId, 'exit 3');
    expect(o.exitCode).toBe(3);
  });

  it('sleep 100 + timeout 2 -> aborted', async () => {
    const o = await execInContainer(convId, 'sleep 100', { timeoutSec: 2 });
    expect(o.aborted).toBe(true);
  });

  it('yes | head -c 100MB -> truncated + note 路径', async () => {
    const o = await execInContainer(convId, 'yes | head -c 100000000', { timeoutSec: 60 });
    expect(o.truncated).toBe(true);
    expect(o.note).toContain('/tmp/aiw-out-');
    // 展示文本不超过 8KB 量级
    expect(Buffer.byteLength(o.stdout, 'utf8')).toBeLessThanOrEqual(8 * 1024 + 256);
  });

  it('ANSI 转义码被清洗', async () => {
    const o = await execInContainer(convId, "printf '\\x1b[31mred\\x1b[0m'");
    expect(o.stdout).not.toContain('\x1b');
    expect(o.stdout).toContain('red');
  });

  it('后置：清理容器', () => {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  });
});
