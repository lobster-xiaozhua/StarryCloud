/**
 * T15 启动恢复 · 校验
 * 断言 T15 夹具塞入的那条 status='streaming' 消息已被启动清理删除。
 *
 * 用法（通常在启动过一次 server 之后执行）：
 *   npx tsx scripts/t15-verify.ts
 * 也可独立验证清理逻辑本身：
 *   npx tsx scripts/t15-verify.ts --offline   # 直接调 cleanStaleMessages() 再断言
 */
import { db } from '../server/src/db/client.ts';
import { cleanStaleMessages } from '../server/src/index.ts';

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline');

  const before = await db.messages.findByStatus('streaming');
  console.log(`[t15-verify] streaming 消息数（${offline ? '清理前' : '当前'}）= ${before.length}`);

  if (offline) {
    const cleaned = await cleanStaleMessages();
    console.log(`[t15-verify] cleanStaleMessages() 删除 ${cleaned} 条`);
  }

  const after = await db.messages.findByStatus('streaming');
  console.log(`[t15-verify] streaming 消息数（校验时）= ${after.length}`);

  if (after.length !== 0) {
    console.error('[t15-verify] FAIL：仍存在 status=streaming 的残留消息');
    process.exit(1);
  }

  console.log('[t15-verify] PASS：无残留 streaming 消息');
  process.exit(0);
}

void main();
