import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { conversationsRouter } from './routes/conversations.ts';
import { messagesRouter } from './routes/messages.ts';
import { runsRouter } from './routes/runs.ts';
import { settingsRouter } from './routes/settings.ts';
import { db } from './db/client.ts';

/**
 * T15 启动恢复：清理上一进程崩溃/被杀时残留的 status='streaming' 消息。
 *
 * 关键：是**删除**，不是改状态。
 * 残缺的 tool_call 无法修复成合法消息（tool_call 有 id 但无对应 tool_result，
 * 送模型会被 OpenAI 协议拒绝/400），改状态只会留下更隐蔽的坏数据。
 */
export async function cleanStaleMessages(): Promise<number> {
  const stale = await db.messages.findByStatus('streaming');
  for (const m of stale) {
    await db.messages.delete(m.id);
  }
  if (stale.length > 0) {
    console.log(`[server] cleaned ${stale.length} stale messages`);
  }
  return stale.length;
}

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/conversations', messagesRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/settings', settingsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'internal error';
    res.status(500).json({ error: message });
  });

  return app;
}

const PORT = Number(process.env.PORT ?? 3000);
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // 先做启动恢复，再对外提供服务
  await cleanStaleMessages();
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}
