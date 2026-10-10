import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { seedIncident } from "../src/seed.ts";

type LogLine = {
  msg: string;
  mission_id?: string;
  idempotency_key?: string;
  approved_at?: string;
  provider_status?: string;
};

const incident = readFileSync(new URL("../logs/incident.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as LogLine);

function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("replay do incidente de 13 de março", () => {
  it("as requisições do log, na ordem, deixam um crédito por missão no valor certo e o PENDING pendente", async () => {
    const db = openDatabase(":memory:");
    seedIncident(db);
    const app = createApp(db);
    const payoutByMission = new Map<string, string>();
    const statuses: number[] = [];

    for (const line of incident) {
      if (line.msg === "approval.received") {
        const res = await post(app, "/approvals", {
          mission_id: line.mission_id,
          approved_at: line.approved_at,
          idempotency_key: line.idempotency_key,
        });
        statuses.push(res.status);
        const body = (await res.json()) as { payout?: { id: string } | null };
        if (body.payout && line.mission_id) payoutByMission.set(line.mission_id, body.payout.id);
      }
      if (line.msg === "provider.callback" && line.mission_id) {
        const payoutId = payoutByMission.get(line.mission_id);
        expect(payoutId).toBeDefined();
        const res = await post(app, `/payouts/${payoutId}/provider`, { provider_status: line.provider_status });
        expect(await res.json()).toMatchObject({ status: "pending" });
      }
    }

    // pay_9f3 (22:02 em São Paulo) credita; as repetições com espaço e U+200B devolvem o original.
    expect(statuses).toEqual([201, 201, 200, 201, 200]);
    const ledger = db
      .prepare("SELECT mission_id, amount_brl FROM ledger ORDER BY mission_id")
      .all() as Array<{ mission_id: string; amount_brl: number }>;
    expect(ledger).toEqual([
      { mission_id: "msn_1842", amount_brl: 150 },
      { mission_id: "msn_1900", amount_brl: 150 },
      { mission_id: "msn_2044", amount_brl: 80 },
    ]);
  });
});
