import { Router } from 'express';
import { bus } from '../sse/bus.ts';

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
