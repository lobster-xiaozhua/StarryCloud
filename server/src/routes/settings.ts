import { Router } from 'express';

export const settingsRouter = Router();

// T4 阶段：settings 用内存存储（db 公共 facade 未暴露 settings 方法，且 MVP 不强依赖持久化设置）。
// 后续如需持久化，可在 db worker 增加内部 settings 方法，不影响对外契约。
const store = new Map<string, string>();

settingsRouter.get('/', (_req, res) => {
  const value = store.get('model') ?? process.env.MODEL ?? '';
  res.json({ model: value });
});

settingsRouter.put('/', (req, res) => {
  const key = req.body?.key;
  const value = req.body?.value;
  if (typeof key !== 'string' || typeof value !== 'string') {
    return res.status(400).json({ error: 'key and value are required' });
  }
  store.set(key, value);
  res.status(200).json({ ok: true });
});
