import { h } from 'preact';
import htm from 'htm';
import { render } from 'preact';
import { App } from './app.tsx';

const html = htm.bind(h);

render(html`<${App} />`, document.getElementById('app')!);
