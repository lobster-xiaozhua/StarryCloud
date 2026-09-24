import { h } from 'preact';
import htm from 'htm';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import type { MessageDTO } from '@aiw/contracts/api';
import { getState, setState, useStore, type ChatMessageView, type ToolBlockState } from './store.ts';
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
  const runIdRef = useRef<string | null>(null);

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

  // T13：停止 = 通知服务端 abort（触发 AbortSignal），并保持 SSE 订阅
  // 继续接收最终的 done(aborted)，由 done 处理器负责收尾关闭。
  const stopStream = useCallback(() => {
    const rid = runIdRef.current;
    if (rid) void api.abortRun(rid);
    else {
      // 没有 runId（连接尚未建立）时退化为直接断开
      esRef.current?.close();
      esRef.current = null;
      setState({ streaming: false });
    }
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
      // 记住 runId，供「停止」按钮调用 abort 端点
      runIdRef.current = runId;
      const es = new EventSource(`/api/runs/${runId}/stream`);
      esRef.current = es;

      let assistant: ChatMessageView = {
        id: 'asst-' + runId,
        conversationId: currentConvId,
        role: 'assistant',
        content: '',
        seq: userMsg.seq + 1,
        status: 'streaming',
        createdAt: Date.now(),
        toolBlocks: [],
      };
      setState({ messages: [...getState().messages, assistant] });

      const replaceAssistant = (next: ChatMessageView) => {
        const all = getState().messages;
        setState({ messages: [...all.slice(0, -1), next] });
      };

      // 契约（@aiw/contracts/events）：SSE 的 data 行就是 seq 所在的那层负载本身，
      // 形如 {"seq":1,"content":"..."}，不是 {data:{...}} 包裹体。此前按包裹体解析，
      // 导致首个 delta 即抛 TypeError、助手消息永远为空且工具块不渲染（见 ISSUES T12）。
      es.addEventListener('delta', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as { seq: number; content: string };
        assistant = { ...assistant, content: assistant.content + ev.content };
        replaceAssistant(assistant);
      });

      // T12：工具过程块
      es.addEventListener('tool_start', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as {
          seq: number;
          toolCallId: string;
          name: string;
          input: unknown;
        };
        const blocks = [...(assistant.toolBlocks ?? [])];
        blocks.push({
          toolCallId: ev.toolCallId,
          name: ev.name,
          input: ev.input,
          done: false,
        });
        assistant = { ...assistant, toolBlocks: blocks };
        replaceAssistant(assistant);
      });
      es.addEventListener('tool_delta', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as {
          seq: number;
          toolCallId: string;
          chunk: string;
        };
        const blocks = (assistant.toolBlocks ?? []).map((b: ToolBlockState) =>
          b.toolCallId === ev.toolCallId
            ? { ...b, output: (b.output ?? '') + ev.chunk }
            : b,
        );
        assistant = { ...assistant, toolBlocks: blocks };
        replaceAssistant(assistant);
      });
      es.addEventListener('tool_end', (e: MessageEvent) => {
        // tool_end 的 data 形如 { seq, toolCallId, output: ToolOutput }，
        // ToolOutput 才是 { exitCode, stdout, stderr, truncated, aborted, ... }
        const ev = JSON.parse(e.data) as {
          seq: number;
          toolCallId: string;
          output: {
            exitCode: number | null;
            stdout: string;
            stderr: string;
            truncated: boolean;
            aborted: boolean;
            durationMs: number;
            note?: string;
          };
        };
        const o = ev.output;
        const text = [
          `exit_code: ${o.exitCode === null ? 'null' : o.exitCode}`,
          o.aborted ? '(aborted)' : '',
          'stdout:',
          o.stdout || '(empty)',
          o.stderr ? 'stderr:' : '',
          o.stderr,
          o.truncated ? `(output truncated; full log: ${o.note ?? 'n/a'})` : '',
        ]
          .filter((x) => x !== '')
          .join('\n');
        const blocks = (assistant.toolBlocks ?? []).map((b: ToolBlockState) =>
          b.toolCallId === ev.toolCallId
            ? {
                ...b,
                done: true,
                exitCode: o.exitCode,
                aborted: o.aborted,
                output: text,
              }
            : b,
        );
        assistant = { ...assistant, toolBlocks: blocks };
        replaceAssistant(assistant);
      });

      es.addEventListener('done', (e: MessageEvent) => {
        void (JSON.parse(e.data) as { finishReason: string });
        assistant = { ...assistant, status: 'complete' };
        replaceAssistant(assistant);
        es.close();
        esRef.current = null;
        runIdRef.current = null;
        setState({ streaming: false });
      });
      es.addEventListener('error', (e: MessageEvent) => {
        const ev = JSON.parse(e.data) as { message: string };
        setState({ error: ev.message });
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
