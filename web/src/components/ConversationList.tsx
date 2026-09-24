import { h } from 'preact';
import htm from 'htm';
import type { ConversationDTO } from '@aiw/contracts/api';

const html = htm.bind(h);

export function ConversationList(props: {
  conversations: ConversationDTO[];
  currentConvId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return html`
    <div class="sidebar">
      <button onClick=${props.onNew}>+ 新对话</button>
      <ul>
        ${props.conversations.map(
          (c: ConversationDTO) => html`
            <li
              key=${c.id}
              class=${c.id === props.currentConvId ? 'active' : ''}
              onClick=${() => props.onSelect(c.id)}
            >
              ${c.title}
            </li>
          `,
        )}
      </ul>
    </div>
  `;
}
