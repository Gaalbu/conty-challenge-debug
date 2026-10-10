import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  deadline_date TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount_brl REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL UNIQUE,
  provider_status TEXT,
  status TEXT NOT NULL
);
`;

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Outra conexão no mesmo arquivo espera o lock de escrita em vez de falhar na hora.
  db.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  ensureUnique(db, "ledger_one_per_mission", "mission_id");
  ensureUnique(db, "ledger_one_per_key", "idempotency_key");
  return db;
}

// Um crédito por missão e por chave também no banco. Um banco do incidente pode já
// ter duplicatas: aí o índice não é criado, nenhuma linha é alterada e o aviso pede
// reconciliação. A checagem da aplicação continua valendo.
function ensureUnique(db: DatabaseSync, index: string, column: "mission_id" | "idempotency_key"): void {
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ledger (${column})`);
  } catch {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM (SELECT ${column} FROM ledger GROUP BY ${column} HAVING COUNT(*) > 1)`)
      .get() as { n: number };
    console.warn(
      `[repasses] ${row.n} valor(es) de ${column} repetidos no ledger: ${index} não foi criado e nenhuma linha foi alterada. Reconcilie antes de criar o índice.`,
    );
  }
}
