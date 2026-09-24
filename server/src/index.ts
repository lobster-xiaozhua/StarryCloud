import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { conversationsRouter } from './routes/conversations.ts';
import { messagesRouter } from './routes/messages.ts';
import { runsRouter } from './routes/runs.ts';
import { settingsRouter } from './routes/settings.ts';

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
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}
