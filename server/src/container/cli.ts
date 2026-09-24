import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

// 用 child_process.execFile 调 docker CLI（不引入 dockerode）。
export function docker(
  args: string[],
  opts?: { timeout?: number },
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    execFile(
      'docker',
      args,
      {
        timeout: opts?.timeout,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        let code = 0;
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          if (typeof e.code === 'number') code = e.code;
          else if (e.code === 'ETIMEDOUT' || e.killed) code = 124;
          else code = 1;
        }
        resolve({
          code,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      },
    );
  });
}
