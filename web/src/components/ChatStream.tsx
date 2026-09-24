import { h } from 'preact';
import htm from 'htm';
import type { MessageDTO } from '@aiw/contracts/api';

const html = htm.bind(h);

export function ChatStream(props: { messages: MessageDTO[] }) {
  return html`
    <div class="messages">
      ${props.messages.map(
        (m: MessageDTO) => html`
          <div class=${'msg ' + m.role} key=${m.id}>
            <div class="role">${m.role}</div>
            <div class="content">${m.content || '(空)'}</div>
            ${m.toolCall
              ? html`<div class="tool">🔧 ${m.toolCall.name}</div>`
              : null}
          </div>
        `,
      )}
    </div>
  `;
}
