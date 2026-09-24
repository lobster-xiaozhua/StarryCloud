import { h } from 'preact';
import htm from 'htm';
import { useState } from 'preact/hooks';
import type { ToolBlockState } from '../store.ts';

const html = htm.bind(h);

function inputSummary(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (typeof o.command === 'string') return o.command;
    if (typeof o.path === 'string') return o.path;
    return JSON.stringify(input);
  }
  return String(input ?? '');
}

export function ToolBlock(props: { block: ToolBlockState }) {
  const { block } = props;
  const [open, setOpen] = useState(false);

  let badge;
  if (!block.done) {
    badge = html`<span class="badge running">运行中…</span>`;
  } else if (block.aborted) {
    badge = html`<span class="badge aborted">已中断</span>`;
  } else {
    const ok = block.exitCode === 0;
    badge = html`<span class=${'badge ' + (ok ? 'ok' : 'err')}>exit ${block.exitCode ?? '?'}</span>`;
  }

  return html`
    <div class="toolblock">
      <div class="toolblock-head" onClick=${() => setOpen(!open)}>
        🔧 ${block.name} · <code>${inputSummary(block.input)}</code> ${badge}
      </div>
      ${open ? html`<pre class="toolblock-body">${block.output || '(空)'}</pre>` : null}
    </div>
  `;
}
