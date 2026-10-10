import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { seedIncident } from "../src/seed.ts";

type App = ReturnType<typeof createApp>;

function setup(): App {
  const db = openDatabase(":memory:");
  seedIncident(db);
  return createApp(db);
}

async function postJson(app: App, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("aprovação da entrega", () => {
  let app: App;

  beforeEach(() => {
    app = setup();
  });

  it("credita a missão aprovada às 22:02 em São Paulo no dia do prazo", async () => {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_1842",
      approved_at: "2026-03-13T01:02:00.000Z",
      idempotency_key: "pay_9f3",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ledger: { amount_brl: number } };
    expect(body.ledger.amount_brl).toBe(150);
  });

  it("grava o valor da missão em reais", async () => {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_1900",
      approved_at: "2026-03-12T18:11:00.000Z",
      idempotency_key: "pay_22a",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ledger: { amount_brl: number } };
    expect(body.ledger.amount_brl).toBe(150);
  });

  it("não credita de novo quando a confirmação do provedor chega outra vez", async () => {
    const first = await postJson(app, "/approvals", {
      mission_id: "msn_1900",
      approved_at: "2026-03-12T18:11:00.000Z",
      idempotency_key: "pay_22a",
    });
    expect(first.status).toBe(201);
    const second = await postJson(app, "/approvals", {
      mission_id: "msn_1900",
      approved_at: "2026-03-12T18:11:00.000Z",
      idempotency_key: "pay_22a ",
    });
    expect(second.status).toBeLessThan(500);
    const mission = await app.request("/missions/msn_1900");
    const body = (await mission.json()) as { ledger: unknown[] };
    expect(body.ledger).toHaveLength(1);
  });

  it("não credita de novo quando a chave repete com espaço de largura zero", async () => {
    const first = await postJson(app, "/approvals", {
      mission_id: "msn_2044",
      approved_at: "2026-03-20T15:00:00.000Z",
      idempotency_key: "pay_7c1",
    });
    expect(first.status).toBe(201);
    const second = await postJson(app, "/approvals", {
      mission_id: "msn_2044",
      approved_at: "2026-03-20T15:00:00.000Z",
      idempotency_key: "pay_7c1\u200b",
    });
    expect(second.status).toBe(200);
    const mission = await app.request("/missions/msn_2044");
    const body = (await mission.json()) as { ledger: Array<{ amount_brl: number }> };
    expect(body.ledger).toHaveLength(1);
    expect(body.ledger[0]?.amount_brl).toBe(80);
  });

  it("aceita o último instante do dia do prazo em São Paulo", async () => {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_1842",
      approved_at: "2026-03-13T02:59:59.999Z",
      idempotency_key: "pay_last_instant",
    });
    expect(res.status).toBe(201);
  });

  it("aceita a mesma chave uma única vez", async () => {
    const payload = {
      mission_id: "msn_2044",
      approved_at: "2026-03-20T15:00:00.000Z",
      idempotency_key: "pay_same",
    };
    expect((await postJson(app, "/approvals", payload)).status).toBe(201);
    expect((await postJson(app, "/approvals", payload)).status).toBe(200);
    const mission = await app.request("/missions/msn_2044");
    const body = (await mission.json()) as { ledger: unknown[] };
    expect(body.ledger).toHaveLength(1);
  });

  it("recusa aprovação no dia seguinte ao prazo", async () => {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_1842",
      approved_at: "2026-03-13T15:00:00.000Z",
      idempotency_key: "pay_late",
    });
    expect(res.status).toBe(409);
  });

  it("responde 404 para missão inexistente", async () => {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_missing",
      approved_at: "2026-03-12T18:11:00.000Z",
      idempotency_key: "pay_missing",
    });
    expect(res.status).toBe(404);
  });
});

describe("status do provedor", () => {
  let app: App;

  beforeEach(() => {
    app = setup();
  });

  async function payoutId(): Promise<string> {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_2044",
      approved_at: "2026-03-20T15:00:00.000Z",
      idempotency_key: "pay_provider",
    });
    const body = (await res.json()) as { payout: { id: string } };
    return body.payout.id;
  }

  it("mantém o repasse pendente enquanto o provedor não confirma", async () => {
    const id = await payoutId();
    const res = await postJson(app, `/payouts/${id}/provider`, { provider_status: "PENDING" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");
  });

  it("marca como pago quando o provedor confirma o recebimento", async () => {
    const id = await payoutId();
    const res = await postJson(app, `/payouts/${id}/provider`, { provider_status: "RECEIVED" });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("paid");
  });

  it("marca como pago quando o provedor confirma", async () => {
    const id = await payoutId();
    const res = await postJson(app, `/payouts/${id}/provider`, { provider_status: "CONFIRMED" });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("paid");
  });

  it("marca falha quando o provedor falha", async () => {
    const id = await payoutId();
    const res = await postJson(app, `/payouts/${id}/provider`, { provider_status: "FAILED" });
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("failed");
  });
});

describe("integridade do crédito", () => {
  let app: App;

  beforeEach(() => {
    app = setup();
  });

  const approval = (mission_id: string, idempotency_key: string) => ({
    mission_id,
    approved_at: "2026-03-12T15:00:00.000Z",
    idempotency_key,
  });

  it("recusa chave que fica vazia depois de normalizar, sem gravar crédito", async () => {
    for (const key of ["​", "‌", "   ", " "]) {
      expect((await postJson(app, "/approvals", approval("msn_1842", key))).status).toBe(400);
    }
    const body = (await (await app.request("/missions/msn_1842")).json()) as { ledger: unknown[] };
    expect(body.ledger).toHaveLength(0);
  });

  it("recusa com 409 a mesma chave reaproveitada em outra missão", async () => {
    expect((await postJson(app, "/approvals", approval("msn_1842", "shared"))).status).toBe(201);
    const res = await postJson(app, "/approvals", { ...approval("msn_1900", "shared"), approved_at: "2026-03-15T15:00:00.000Z" });
    expect(res.status).toBe(409);
    const other = (await (await app.request("/missions/msn_1900")).json()) as { ledger: unknown[] };
    expect(other.ledger).toHaveLength(0);
  });

  it("não credita duas vezes a mesma missão aprovada com outra chave", async () => {
    expect((await postJson(app, "/approvals", approval("msn_1842", "first"))).status).toBe(201);
    expect((await postJson(app, "/approvals", approval("msn_1842", "second"))).status).toBe(200);
    const body = (await (await app.request("/missions/msn_1842")).json()) as { ledger: unknown[] };
    expect(body.ledger).toHaveLength(1);
  });

  it("falha no repasse desfaz o crédito e o retry com a mesma chave credita uma vez", async () => {
    const db = openDatabase(":memory:");
    seedIncident(db);
    const failing = createApp(db);
    db.exec(`CREATE TRIGGER fail_payout BEFORE INSERT ON payouts BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`);

    expect((await postJson(failing, "/approvals", approval("msn_1842", "pay_retry"))).status).toBe(500);
    const after = (await (await failing.request("/missions/msn_1842")).json()) as {
      mission: { status: string };
      ledger: unknown[];
    };
    expect(after.ledger).toHaveLength(0);
    expect(after.mission.status).toBe("open");

    db.exec("DROP TRIGGER fail_payout");
    expect((await postJson(failing, "/approvals", approval("msn_1842", "pay_retry"))).status).toBe(201);
    const done = (await (await failing.request("/missions/msn_1842")).json()) as { ledger: unknown[] };
    expect(done.ledger).toHaveLength(1);
  });
});

describe("data da aprovação", () => {
  let app: App;

  beforeEach(() => {
    app = setup();
  });

  it("recusa data sem fuso, só o dia ou dia impossível, sem gravar crédito", async () => {
    for (const approved_at of ["2026-03-12T22:02:00", "2026-03-12", "2026-02-30T12:00:00.000Z", "ontem"]) {
      const res = await postJson(app, "/approvals", { mission_id: "msn_1842", approved_at, idempotency_key: `k_${approved_at}` });
      expect([approved_at, res.status]).toEqual([approved_at, 400]);
    }
    const body = (await (await app.request("/missions/msn_1842")).json()) as { ledger: unknown[] };
    expect(body.ledger).toHaveLength(0);
  });

  it("aceita offset explícito de São Paulo no último minuto do dia do prazo", async () => {
    const res = await postJson(app, "/approvals", {
      mission_id: "msn_1842",
      approved_at: "2026-03-12T23:59:00-03:00",
      idempotency_key: "pay_offset",
    });
    expect(res.status).toBe(201);
  });
});
