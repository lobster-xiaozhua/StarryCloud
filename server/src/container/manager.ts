import fs from 'node:fs';
import path from 'node:path';
import { docker } from './cli.ts';
import { db } from '../db/client.ts';

const LABEL = 'app=ai-workbench';
const SANDBOX_UID = 1000;
const SANDBOX_GID = 1000;

export function containerName(convId: string): string {
  return `aiw-${convId}`;
}

export function workspacePath(convId: string): string {
  const DATA_DIR = process.env.DATA_DIR ?? path.resolve('./data');
  return path.join(DATA_DIR, 'workspaces', convId);
}

const inflight = new Map<string, Promise<string>>();

export const containers = {
  async ensure(convId: string): Promise<string> {
    const existing = inflight.get(convId);
    if (existing) return existing;

    const p = (async () => {
      const name = containerName(convId);
      const insp = await docker(['inspect', name]);
      if (insp.code === 0) return name;

      // 确保宿主目录存在且属主 1000:1000（否则容器内 1000 无法写）
      const wp = workspacePath(convId);
      await fs.promises.mkdir(wp, { recursive: true });
      await fs.promises.chown(wp, SANDBOX_UID, SANDBOX_GID);

      const r = await docker([
        'run',
        '-d',
        '--name',
        name,
        '--label',
        LABEL,
        '--user',
        `${SANDBOX_UID}:${SANDBOX_GID}`,
        '--cap-drop=ALL',
        '--security-opt',
        'no-new-privileges',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=512m',
        '--tmpfs',
        '/run:rw,noexec,nosuid,size=64m',
        '--tmpfs',
        '/home/sandbox:rw,noexec,nosuid,size=256m',
        '-v',
        `${wp}:/workspace:rw`,
        '--memory=4g',
        '--memory-swap=4g',
        '--cpus=4',
        '--pids-limit=512',
        '--ulimit',
        'nofile=4096:4096',
        '--ulimit',
        'nproc=512:512',
        '--ulimit',
        'fsize=2g:2g',
        '--network=none',
        'aiw-sandbox:latest',
        'sleep',
        'infinity',
      ]);

      if (r.code !== 0) {
        throw new Error(`docker run failed (${r.code}): ${r.stderr}`);
      }
      return name;
    })();

    inflight.set(convId, p);
    try {
      return await p;
    } finally {
      inflight.delete(convId);
    }
  },

  async stop(convId: string): Promise<void> {
    await docker(['stop', containerName(convId)]);
  },

  async inspect(convId: string): Promise<'running' | 'stopped' | 'missing'> {
    const r = await docker([
      'inspect',
      '-f',
      '{{.State.Running}}',
      containerName(convId),
    ]);
    if (r.code !== 0) return 'missing';
    return r.stdout.trim() === 'true' ? 'running' : 'stopped';
  },

  async reconcile(): Promise<void> {
    const ps = await docker([
      'ps',
      '-a',
      '--filter',
      `label=${LABEL}`,
      '--format',
      '{{.Names}}',
    ]);
    if (ps.code !== 0) return;
    const names = ps.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const convs = await db.conversations.list();
    const valid = new Set(convs.map((c) => c.id));
    for (const name of names) {
      const id = name.startsWith('aiw-') ? name.slice(4) : name;
      if (!valid.has(id)) {
        await docker(['rm', '-f', name]);
      }
    }
  },
};
