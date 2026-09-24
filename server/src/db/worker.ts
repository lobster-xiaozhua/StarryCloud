import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations, dispatch } from './repo.ts';

interface DbRequest {
  id: number;
  method: string;
  params: unknown;
}
interface DbResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string; stack?: string };
}

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('./data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
runMigrations(db);

process.on('message', (req: DbRequest) => {
  if (req.method === 'close') {
    db.close();
    process.send!({ id: req.id, ok: true, result: null } satisfies DbResponse);
    setImmediate(() => process.exit(0));
    return;
  }
  try {
    const result = dispatch(db, req.method, req.params);
    process.send!({ id: req.id, ok: true, result } satisfies DbResponse);
  } catch (e) {
    const err = e as Error;
    process.send!({
      id: req.id,
      ok: false,
      error: { message: err.message, stack: err.stack },
    } satisfies DbResponse);
  }
});
