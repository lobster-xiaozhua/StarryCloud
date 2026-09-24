import { useState, useEffect } from 'preact/hooks';
import type { ConversationDTO, MessageDTO } from '@aiw/contracts/api';

export interface AppState {
  conversations: ConversationDTO[];
  currentConvId: string | null;
  messages: MessageDTO[];
  streaming: boolean;
  error: string | null;
}

let state: AppState = {
  conversations: [],
  currentConvId: null,
  messages: [],
  streaming: false,
  error: null,
};

const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useStore<T>(selector: (s: AppState) => T): T {
  const [val, setVal] = useState<T>(() => selector(getState()));
  useEffect(() => {
    const update = () => setVal(selector(getState()));
    return subscribe(update);
  }, []);
  return val;
}
