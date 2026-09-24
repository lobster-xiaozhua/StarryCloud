import { Router } from 'express';
import { bus } from '../sse/bus.ts';
import { runs } from '../runs.ts';

export const runsRouter = Router();

runsRouter.get('/:runId/stream', (req, res) => {
  const runId = req.params.runId!;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  if (res.socket) {
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }

  const lastEventId = req.headers['last-event-id'];
  const fromSeq = lastEventId ? Number(lastEventId) || 0 : 0;

  const unsub = bus.subscribe(runId, fromSeq, (ev) => {
    res.write(
      `id: ${ev.data.seq}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`,
    );
  });

  const ping = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(ping);
    unsub();
  });
});

// T13：abort 全链路。按 runId 找到进行中的 handle，触发其 AbortSignal，
// 由 agent 主循环与 execInContainer 的 signal 监听共同收束，最终以 done(aborted) 结束。
runsRouter.post('/:runId/abort', (req, res) => {
  const runId = req.params.runId!;

  let handle = null as null | { runId: string; convId: string; abort: AbortController };
  for (const h of runs.values()) {
    if (h.runId === runId) {
      handle = h;
      break;
    }
  }
  if (!handle) return res.status(404).json({ error: 'run not found or already finished' });

  handle.abort.abort();
  res.json({ ok: true, runId });
});
