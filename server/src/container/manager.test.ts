import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { containerName, containers, workspacePath } from './manager.ts';

// 沙箱内无法 build aiw-sandbox 镜像（apt/nodejs.org 不可达）。
// 镜像缺失时整组测试自跳过，套件保持绿色；在能联网的机器上会真实执行。
function hasSandboxImage(): boolean {
  try {
    execFileSync('docker', ['inspect', 'aiw-sandbox:latest'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const suite = hasSandboxImage() ? describe : describe.skip;

suite('container/manager', () => {
  const convId = `test-mgr-${Math.random().toString(36).slice(2, 8)}`;
  const name = containerName(convId);

  beforeAll(() => {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  });

  afterAll(() => {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    fs.rmSync(workspacePath(convId), { recursive: true, force: true });
  });

  it('ensure 两次返回同一 id', async () => {
    const a = await containers.ensure(convId);
    const b = await containers.ensure(convId);
    expect(a).toBe(name);
    expect(b).toBe(name);
  });

  it('ensure 后 inspect = running', async () => {
    const st = await containers.inspect(convId);
    expect(st).toBe('running');
  });

  it('stop 后 inspect = stopped', async () => {
    await containers.stop(convId);
    const st = await containers.inspect(convId);
    expect(st).toBe('stopped');
  });

  it('docker rm 后 inspect = missing', async () => {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const st = await containers.inspect(convId);
    expect(st).toBe('missing');
  });

  it('rm 后 ensure 能重建', async () => {
    const a = await containers.ensure(convId);
    expect(a).toBe(name);
    const st = await containers.inspect(convId);
    expect(st).toBe('running');
  });
});
