import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolOutput } from '@aiw/contracts/tools';
import { docker } from './cli.ts';
import { containers } from './manager.ts';

const MAX_OUTPUT_BYTES = 8 * 1024;

// 头 60% + 尾 40% 保留，中间丢弃
const HEAD_RATIO = 0.6;
const HEAD_BYTES = Math.floor(MAX_OUTPUT_BYTES * HEAD_RATIO);
const TAIL_BYTES = MAX_OUTPUT_BYTES - HEAD_BYTES;

// 清洗 ANSI 转义码（颜色 / 光标等）
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/**
 * 增量收集子进程输出，避免把整段输出驻留在 JS 字符串里。
 *
 * 背景：早先实现用 `full += chunk` 累加，并每块做一次 `Buffer.byteLength(full)`。
 * 在 100MB 级输出下，字符串拼接退化为 O(N^2)（V8 rope 节点数 ~13 万），
 * 实测单次 exec 耗时 37s（raw docker exec 仅 0.09s）。此处改为：
 *  - 头部最多 HEAD_BYTES 存入内存（多余部分丢弃）；
 *  - 尾部用一个“最多 2*TAIL_BYTES 的滚动缓冲”承接（超限即裁掉最旧字节）；
 *  - 全量原文边收边写入临时文件（stdout/stderr 各一），供落盘 note 使用。
 * 这样常驻内存恒定 ≤ ~24KB，且无超线性开销。
 */
class OutputBuffer {
  private readonly chunks: Buffer[] = [];
  private headLen = 0;
  private readonly tailChunks: Buffer[] = [];
  private tailLen = 0;
  private fullBytes = 0;
  private readonly fd: number;
  private readonly filePath: string;

  truncated = false;

  constructor(private readonly sub: string) {
    this.filePath = path.join(os.tmpdir(), `aiw-${sub}-${randomUUID()}.log`);
    this.fd = fs.openSync(this.filePath, 'w');
  }

  push(chunk: Buffer): void {
    this.fullBytes += chunk.length;
    try {
      fs.writeSync(this.fd, chunk);
    } catch {
      /* 落盘失败不应影响执行结果 */
    }
    if (this.fullBytes > MAX_OUTPUT_BYTES) this.truncated = true;

    if (this.headLen < HEAD_BYTES) {
      const take = Math.min(HEAD_BYTES - this.headLen, chunk.length);
      if (take > 0) {
        this.chunks.push(chunk.subarray(0, take));
        this.headLen += take;
      }
      const rest = chunk.subarray(take);
      if (rest.length > 0) this.pushTail(rest);
    } else {
      this.pushTail(chunk);
    }
  }

  // 滚动尾部缓冲：超过 2*TAIL_BYTES 就丢弃最旧数据，常驻内存恒定
  private pushTail(buf: Buffer): void {
    this.tailChunks.push(buf);
    this.tailLen += buf.length;
    while (this.tailLen > TAIL_BYTES * 2 && this.tailChunks.length > 1) {
      const first = this.tailChunks[0] as Buffer;
      if (this.tailLen - first.length >= TAIL_BYTES) {
        this.tailChunks.shift();
        this.tailLen -= first.length;
      } else break;
    }
  }

  bytes(): number {
    return this.fullBytes;
  }

  /** 返回清洗后的展示文本（超 8KB 则头 60% + 尾 40%） */
  display(): string {
    if (this.fullBytes <= MAX_OUTPUT_BYTES) {
      return stripAnsi(Buffer.concat(this.chunks).toString('utf8'));
    }
    const headStr = Buffer.concat(this.chunks).toString('utf8');
    const tailAll = Buffer.concat(this.tailChunks);
    const tailStr = tailAll.subarray(Math.max(0, tailAll.length - TAIL_BYTES)).toString('utf8');
    return stripAnsi(`${headStr}\n…[已截断，完整日志见 note]…\n${tailStr}`);
  }

  /** 读取本流全量原文并关闭句柄 */
  readAllAndClose(): string {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* ignore */
    }
    try {
      return fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return '';
    }
  }

  /** 丢弃临时文件（无需落盘时调用） */
  discard(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// 把完整日志写入容器内 /tmp（/tmp 是 tmpfs，noexec 不影响落盘）
async function writeFullLog(id: string, logPath: string, full: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const c = spawn('docker', ['exec', '-i', id, 'sh', '-c', `cat > ${logPath}`], {
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

  const stdout = new OutputBuffer('out');
  const stderr = new OutputBuffer('err');
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

    child.stdout?.on('data', (d: Buffer) => stdout.push(d));
    child.stderr?.on('data', (d: Buffer) => stderr.push(d));

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
    const full = `=== STDOUT ===\n${stdout.readAllAndClose()}\n=== STDERR ===\n${stderr.readAllAndClose()}`;
    await writeFullLog(id, logPath, full);
    note = logPath;
  } else {
    stdout.readAllAndClose();
    stderr.readAllAndClose();
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
