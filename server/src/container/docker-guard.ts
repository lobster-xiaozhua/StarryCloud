import { execFileSync } from 'node:child_process';
import { describe } from 'vitest';

export const SANDBOX_IMAGE = 'aiw-sandbox:latest';

export function hasSandboxImage(): boolean {
  try {
    execFileSync('docker', ['inspect', SANDBOX_IMAGE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 返回应当使用的 describe 函数：
 * - 镜像存在：真实执行
 * - 镜像缺失且 AIW_REQUIRE_DOCKER=1：抛错，令套件失败（CI / 用户机器上强制真跑）
 * - 镜像缺失且未强制：打印醒目 [SKIP] 提示后跳过（绝不静默）
 */
export function dockerSuite(label: string): typeof describe {
  const hasImage = hasSandboxImage();
  const required = process.env['AIW_REQUIRE_DOCKER'] === '1';

  if (hasImage) return describe;

  const hint = `[SKIP] ${SANDBOX_IMAGE} not found. Run: docker build -f Dockerfile.sandbox -t ${SANDBOX_IMAGE} .`;
  if (required) {
    throw new Error(
      `AIW_REQUIRE_DOCKER=1 but ${SANDBOX_IMAGE} is missing.\n${hint}`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `${hint}\n[SKIP] suite "${label}" will be skipped (set AIW_REQUIRE_DOCKER=1 to fail instead).`,
  );
  return describe.skip as unknown as typeof describe;
}
