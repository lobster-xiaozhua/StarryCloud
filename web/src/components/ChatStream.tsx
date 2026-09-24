import { h } from 'preact';
import htm from 'htm';
import type { ChatMessageView } from '../store.ts';
import { ToolBlock } from './ToolBlock.tsx';

const html = htm.bind(h);

export function ChatStream(props: { messages: ChatMessageView[] }) {
  return html`
    <div class="messages">
      ${props.messages.map(
        (m: ChatMessageView) => html`
          <div class=${'msg ' + m.role} key=${m.id}>
            <div class="role">${m.role}</div>
            <div class="content">${m.content || ''}</div>
            ${(m.toolBlocks ?? []).map((b) => html`<${ToolBlock} block=${b} />`)}
            ${m.toolCall && !(m.toolBlocks?.length)
              ? html`<div class="tool">🔧 ${m.toolCall.name}</div>`
              : null}
          </div>
        `,
      )}
    </div>
  `;
}
