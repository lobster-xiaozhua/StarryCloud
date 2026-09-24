import { randomUUID } from 'node:crypto';
import { execInContainer } from '../server/src/container/exec.ts';
import { containers, containerName } from '../server/src/container/manager.ts';

// CP3 自测：在沙箱容器里真实执行 echo hello，校验 exitCode=0 且 stdout 含 hello。
const convId = `cp3-${randomUUID()}`;

async function main(): Promise<void> {
  const out = await execInContainer(convId, 'echo hello');
  if (out.exitCode !== 0) {
    throw new Error(`exitCode 非 0: ${out.exitCode}\n${out.stdout}\n${out.stderr}`);
  }
  if (!out.stdout.includes('hello')) {
    throw new Error(`stdout 不含 hello: ${JSON.stringify(out.stdout)}`);
  }
  console.log('[cp3-smoke] PASS：exitCode=0，stdout 含 hello');
}

main()
  .then(async () => {
    await containers.stop(convId).catch(() => undefined);
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('[cp3-smoke] FAIL:', e instanceof Error ? e.message : e);
    await containers.stop(convId).catch(() => undefined);
    process.exit(1);
  });
