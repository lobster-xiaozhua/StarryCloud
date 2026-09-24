import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { MessageDTO } from '@aiw/contracts/api';
import { getState, setState, useStore } from './store.ts';
import * as api from './api.ts';
import { ConversationList } from './components/ConversationList.tsx';
import { ChatStream } from './components/ChatStream.tsx';

const html = htm.bind(h);

export function App() {
  const conversations = useStore((s) => s.conversations);
  const currentConvId = useStore((s) => s.currentConvId);
  const messages = useStore((s) => s.messages);
  const streaming = useStore((s) => s.streaming);
  const error = useStore((s) => s.error);
  const [input, setInput] = useState('');
  const esRef = useRef<EventSource | null>(null);

  const refreshConversations = useCallback(async () => {
    const list = await api.listConversations();
    setState({ conversations: list });
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const selectConv = useCallback(async (id: string) => {
    const msgs = await api.listMessages(id);
    setState({ currentConvId: id, messages: msgs, streaming: false });
  }, []);

  const newConv = useCallback(async () => {
    const conv = await api.createConversation();
    await refreshConversations();
    await selectConv(conv.id);
  }, [refreshConversations, selectConv]);

  const stopStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setState({ streaming: false });
  }, []);

  const send = useCallback(async () => {
    if (!currentConvId || !input.trim() || streaming) return;
    const content = input.trim();
    setInput('');

    const userMsg: MessageDTO = {
      id: 'local-' + Date.now(),
      conversationId: currentConvId,
      role: 'user',
      content,
      seq: getState().messages.length + 1,
      status: 'complete',
      createdAt: Date.now(),
    };
    setState({ messages: [...getState().messages, userMsg], streaming: true });

    try {
      const runId = await api.sendMessage(currentConvId, content);
      const es = new EventSource(`/api/runs/${runId}/stream`);
      esRef.current = es;

      let assistant: MessageDTO = {
        id: 'asst-' + runId,
        conversationId: currentConvId,
        role: 'assistant',
        content: '',
        seq: userMsg.seq + 1,
        status: 'streaming',
        createdAt: Date.now(),
      };
      setState({ messages: [...getState().messages, assistant] });

      const replaceAssistant = (next: MessageDTO) => {
        const all = getState().messages;
        setState({ messages: [...all.slice(0, -1), next] });
      };

      es.addEventListener('delta', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as { data: { content: string } };
        assistant = { ...assistant, content: assistant.content + ev.data.content };
        replaceAssistant(assistant);
      });
      es.addEventListener('done', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as { data: { finishReason: string } };
        assistant = { ...assistant, status: 'complete' };
        replaceAssistant(assistant);
        es.close();
        esRef.current = null;
        setState({ streaming: false });
        void ev;
      });
      es.addEventListener('error', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as { data: { message: string } };
        setState({ error: ev.data.message });
      });
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setState({ streaming: false });
      };
    } catch (e) {
      setState({ error: String(e), streaming: false });
    }
  }, [currentConvId, input, streaming]);

  return html`
    <div class="app">
      <${ConversationList}
        conversations=${conversations}
        currentConvId=${currentConvId}
        onSelect=${selectConv}
        onNew=${newConv}
      />
      <div class="chat">
        <${ChatStream} messages=${messages} />
        <div class="composer">
          <input
            value=${input}
            onInput=${(e: Event) =>
              setInput((e.target as HTMLInputElement).value)}
            onKeyDown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') void send();
            }}
            disabled=${!currentConvId}
          />
          ${streaming
            ? html`<button onClick=${stopStream}>停止</button>`
            : html`<button
                onClick=${send}
                disabled=${!currentConvId || !input.trim()}
              >
                发送
              </button>`}
        </div>
        ${error ? html`<div class="error">${error}</div>` : null}
      </div>
    </div>
  `;
}
