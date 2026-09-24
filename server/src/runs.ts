export interface RunHandle {
  runId: string;
  convId: string;
  abort: AbortController;
}

// 进行中的 run：convId -> handle。POST /messages 时检查 409，T13 abort 时取用。
export const runs = new Map<string, RunHandle>();
