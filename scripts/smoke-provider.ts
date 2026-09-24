import { openaiProvider } from '../server/src/provider/openai.ts';
import type { ChatMessage } from '@aiw/contracts/messages';

const prompt = process.argv[2];
if (!prompt) {
  console.error('用法: npx tsx scripts/smoke-provider.ts "<你的问题>"');
  console.error('需要环境变量: OPENAI_API_KEY, OPENAI_BASE_URL, 可选 MODEL');
  console.error('无云端 key 时用 Ollama:');
  console.error('  OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama MODEL=llama3 npx tsx scripts/smoke-provider.ts "hi"');
  process.exit(1);
}

const messages: ChatMessage[] = [{ role: 'user', parts: [{ type: 'text', text: prompt }] }];

const ac = new AbortController();
process.on('SIGINT', () => ac.abort());

console.error('[smoke] 连接', process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', 'model=', process.env.MODEL ?? 'deepseek-chat');

const stream = openaiProvider.stream({
  messages,
  tools: [],
  signal: ac.signal,
  model: process.env.MODEL ?? 'deepseek-chat',
});

for await (const ev of stream) {
  if (ev.type === 'text') {
    process.stdout.write(ev.text);
  } else if (ev.type === 'done') {
    process.stdout.write('\n');
    console.error('[smoke] finishReason=', ev.finishReason);
  }
}
