import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ToolOutput } from '@aiw/contracts/tools';
import { docker } from './cli.ts';
import { containers } from './manager.ts';

const MAX_OUTPUT_BYTES = 8 * 1024;

// 头 60% + 尾 40% 保留，中间丢弃
const HEAD_RATIO = 0.6;

// 清洗 ANSI 转义码（颜色 / 光标等）
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

// 累计输出：保留完整原文（用于落盘），同时维护展示用的截断版本
class OutputBuffer {
  private full = '';
  truncated = false;

  push(chunk: string): void {
    this.full += chunk;
    if (Buffer.byteLength(this.full, 'utf8') > MAX_OUTPUT_BYTES) this.truncated = true;
  }

  raw(): string {
    return this.full;
  }

  // 返回清洗后的展示文本（超 8KB 则头 60% + 尾 40%）
  display(): string {
    const buf = Buffer.from(this.full, 'utf8');
    const bytes = buf.length;
    if (bytes <= MAX_OUTPUT_BYTES) return stripAnsi(this.full);
    const head = Math.floor(MAX_OUTPUT_BYTES * HEAD_RATIO);
    const tail = MAX_OUTPUT_BYTES - head;
    const headStr = buf.subarray(0, head).toString('utf8');
    const tailStr = buf.subarray(bytes - tail).toString('utf8');
    return stripAnsi(`${headStr}\n…[已截断，完整日志见 note]…\n${tailStr}`);
  }

  bytes(): number {
    return Buffer.byteLength(this.full, 'utf8');
  }
}

// 把完整日志写入容器内 /tmp（/tmp 是 tmpfs，noexec 不影响落盘）
async function writeFullLog(id: string, path: string, full: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const c = spawn('docker', ['exec', '-i', id, 'sh', '-c', `cat > ${path}`], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    c.on('close', () => resolve());
    c.on('error', () => resolve());
    c.stdin?.on('error', () => undefined);
    c.stdin?.write(full);
    c.stdin?.end();
  });
}

// 超时 / abort 时杀容器内的命令进程组。
// 优先按 pgid 杀（exec 子树挂在容器 PID1 下，用 pgrep 找到会话 bash）；
// 兜底 pkill -P 1（杀 PID1 直系的 exec 子树）。注意：setsid 会让 docker exec 丢退出码，
// 故这里不依赖 setsid，直接用 pkill 按 PID1 子树清理。
async function killGroup(id: string): Promise<void> {
  try {
    const probe = await docker(['exec', id, 'sh', '-c', 'pgrep -P 1 -x bash | head -1']);
    const pid = probe.stdout.trim();
    if (pid) await docker(['exec', id, 'kill', '-TERM', `-${pid}`]).catch(() => undefined);
  } catch {
    /* ignore */
  }
  await docker(['exec', id, 'pkill', '-TERM', '-P', '1']).catch(() => undefined);
}

export async function execInContainer(
  convId: string,
  cmd: string,
  opts: { timeoutSec?: number; signal?: AbortSignal } = {},
): Promise<ToolOutput> {
  const id = await containers.ensure(convId);
  const timeoutSec = opts.timeoutSec ?? 300;
  const startedAt = Date.now();

  const stdout = new OutputBuffer();
  const stderr = new OutputBuffer();
  const abortedRef = { flag: false };

  const env = ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/home/sandbox', 'TERM=dumb'];
  const args = [
    'exec',
    '-w',
    '/workspace',
    ...env.flatMap((e) => ['-e', e]),
    id,
    'bash',
    '-c',
    cmd,
  ];

  let nodeTimer: ReturnType<typeof setTimeout> | undefined;

  const code = await new Promise<number | null>((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout?.on('data', (d: Buffer) => stdout.push(d.toString('utf8')));
    child.stderr?.on('data', (d: Buffer) => stderr.push(d.toString('utf8')));

    child.on('close', (c: number | null) => resolve(c));
    child.on('error', () => resolve(null));

    // Node 侧超时：到点杀进程组并标记中断（不依赖容器内 timeout，避免 bash -c 子树漏杀 + setsid 丢退出码）
    nodeTimer = setTimeout(() => {
      abortedRef.flag = true;
      void killGroup(id);
      child.kill('SIGTERM');
    }, timeoutSec * 1000);

    const onAbort = (): void => {
      abortedRef.flag = true;
      void killGroup(id);
      child.kill('SIGTERM');
    };

    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  if (nodeTimer) clearTimeout(nodeTimer);

  const truncated = stdout.truncated || stderr.truncated;

  let note: string | undefined;
  if (truncated) {
    const logPath = `/tmp/aiw-out-${randomUUID()}.log`;
    const full = `=== STDOUT ===\n${stdout.raw()}\n=== STDERR ===\n${stderr.raw()}`;
    await writeFullLog(id, logPath, full);
    note = logPath;
  }

  return {
    exitCode: code,
    stdout: stdout.display(),
    stderr: stderr.display(),
    truncated,
    stdoutBytes: stdout.bytes(),
    durationMs: Date.now() - startedAt,
    note,
    aborted: abortedRef.flag,
  };
}
