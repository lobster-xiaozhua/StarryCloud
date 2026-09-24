import { Router } from 'express';
import { db } from '../db/client.ts';

export const conversationsRouter = Router();

conversationsRouter.get('/', async (_req, res) => {
  const list = await db.conversations.list();
  res.json(list);
});

conversationsRouter.post('/', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  const conv = await db.conversations.create({ title });
  res.status(201).json({ id: conv.id, createdAt: conv.createdAt });
});

conversationsRouter.get('/:id', async (req, res) => {
  const conv = await db.conversations.get(req.params.id!);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });
  res.json(conv);
});

conversationsRouter.delete('/:id', async (req, res) => {
  await db.conversations.delete(req.params.id!);
  res.status(204).end();
});
