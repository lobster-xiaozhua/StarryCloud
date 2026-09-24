/**
 * T15 启动恢复 · 夹具
 * 往 DB 塞一条 status='streaming' 的残缺 assistant 消息（含无配对的 tool_call），
 * 用于验证服务启动时会把它**删除**。
 *
 * 用法：npx tsx scripts/t15-fixture.ts
 */
import { db } from '../server/src/db/client.ts';

async function main(): Promise<void> {
  const conv = await db.conversations.create({ title: 'T15 启动恢复夹具' });

  const user = await db.messages.append({
    conversationId: conv.id,
    role: 'user',
    parts: [{ type: 'text', text: '帮我统计 data.csv（这条之后进程被杀）' }],
    status: 'complete',
  });

  // 残缺的 assistant：有 tool_call 但永远不会有 tool_result
  const streaming = await db.messages.append({
    conversationId: conv.id,
    role: 'assistant',
    parts: [
      { type: 'text', text: '好的，我来执行…' },
      { type: 'tool_call', id: 'stale-call-1', name: 'run_shell_command', input: { command: 'wc -l data.csv' } },
    ],
    status: 'streaming',
  });

  console.log(`[t15-fixture] conv=${conv.id}`);
  console.log(`[t15-fixture] user=${user.id} (complete)`);
  console.log(`[t15-fixture] streaming=${streaming.id} (status=streaming, 待启动时清理)`);
  process.exit(0);
}

void main();
