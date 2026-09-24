import type { ChatMessage, StoredMessage } from '@aiw/contracts/messages';

// T14 之前：原样返回（保留历史顺序与工具配对）。
// T14 会在此做上下文压缩（最近 N 轮全量、更早 tool 结果摘要、触发式摘要）。
export function compressContext(history: StoredMessage[]): ChatMessage[] {
  return history.map((m) => ({
    role: m.role,
    parts: m.parts,
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
  }));
}
