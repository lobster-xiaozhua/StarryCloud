import { fork, type ChildProcess } from 'node:child_process';
import type { ConversationDTO } from '@aiw/contracts/api';
import type { StoredMessage } from '@aiw/contracts/messages';

interface DbMethodMap {
  'conversations.create': { params: { title?: string }; result: ConversationDTO };
  'conversations.list': { params: undefined; result: ConversationDTO[] };
  'conversations.get': { params: { id: string }; result: ConversationDTO | null };
  'conversations.delete': { params: { id: string }; result: void };
  'messages.append': {
    params: Omit<StoredMessage, 'id' | 'seq' | 'createdAt'>;
    result: StoredMessage;
  };
  'messages.listByConv': { params: { convId: string }; result: StoredMessage[] };
  'messages.updateStatus': {
    params: { id: string; status: StoredMessage['status'] };
    result: void;
  };
  'messages.delete': { params: { id: string }; result: void };
  'messages.findByStatus': {
    params: { status: StoredMessage['status'] };
    result: StoredMessage[];
  };
}

type DbMethod = keyof DbMethodMap;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface DbResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string; stack?: string };
}

let worker: ChildProcess | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): ChildProcess {
  if (worker) return worker;
  const c = fork(new URL('./worker.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
  });
  c.on('message', (msg: DbResponse) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error?.message ?? 'db error'));
  });
  c.on('error', (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  });
  worker = c;
  return c;
}

function rpc<M extends DbMethod>(
  method: M,
  params: DbMethodMap[M]['params'],
): Promise<DbMethodMap[M]['result']> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<DbMethodMap[M]['result']>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    w.send({ id, method, params });
  });
}

async function closeDb(): Promise<void> {
  if (!worker) return;
  const c = worker;
  worker = null;
  const id = ++seq;
  await new Promise<void>((resolve) => {
    pending.set(id, { resolve: () => resolve(), reject: () => resolve() });
    c.send({ id, method: 'close', params: undefined });
  });
  c.kill();
}

export const db = {
  conversations: {
    create(input: { title?: string }): Promise<ConversationDTO> {
      return rpc('conversations.create', input);
    },
    list(): Promise<ConversationDTO[]> {
      return rpc('conversations.list', undefined);
    },
    get(id: string): Promise<ConversationDTO | null> {
      return rpc('conversations.get', { id });
    },
    delete(id: string): Promise<void> {
      return rpc('conversations.delete', { id });
    },
  },
  messages: {
    append(msg: Omit<StoredMessage, 'id' | 'seq' | 'createdAt'>): Promise<StoredMessage> {
      return rpc('messages.append', msg);
    },
    listByConv(convId: string): Promise<StoredMessage[]> {
      return rpc('messages.listByConv', { convId });
    },
    updateStatus(id: string, status: StoredMessage['status']): Promise<void> {
      return rpc('messages.updateStatus', { id, status });
    },
    delete(id: string): Promise<void> {
      return rpc('messages.delete', { id });
    },
    findByStatus(status: StoredMessage['status']): Promise<StoredMessage[]> {
      return rpc('messages.findByStatus', { status });
    },
  },
  close(): Promise<void> {
    return closeDb();
  },
};
