import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { containerName, containers, workspacePath } from './manager.ts';
import { dockerSuite } from './docker-guard.ts';

// 沙箱内无法 build aiw-sandbox 镜像（apt/nodejs.org 不可达）。
// 镜像缺失时：默认打印 [SKIP] 并整组跳过；AIW_REQUIRE_DOCKER=1 时改为失败，强制真跑。
const suite = dockerSuite('container/manager');

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
