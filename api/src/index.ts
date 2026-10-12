import Fastify from "fastify";
import pg from "pg";
import { config } from "./config.ts";
import { lookupGame } from "./itad.ts";

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const app = Fastify({ logger: true });

const toCents = (price: number | null | undefined) =>
  price == null ? null : Math.round(price * 100);

app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok" };
  } catch {
    return reply.code(503).send({ status: "database unavailable" });
  }
});

// Wishlist with the cheapest price from the most recent poll run
app.get("/wishlist", async () => {
  const { rows } = await pool.query(`
    SELECT w.id, w.itad_id, w.title, w.target_price_cents, w.history_low_cents,
           best.price_cents AS best_price_cents, best.currency, best.shop AS best_shop,
           best.url AS best_url, best.fetched_at
    FROM wishlist w
    LEFT JOIN LATERAL (
      SELECT price_cents, currency, shop, url, fetched_at
      FROM price_snapshots s
      WHERE s.game_id = w.id
      ORDER BY fetched_at DESC, price_cents ASC
      LIMIT 1
    ) best ON true
    ORDER BY w.title`);
  return rows;
});

app.post<{ Body: { title: string; targetPrice?: number } }>(
  "/wishlist",
  {
    schema: {
      body: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1 },
          targetPrice: { type: "number", minimum: 0 },
        },
      },
    },
  },
  async (req, reply) => {
    const game = await lookupGame(req.body.title);
    if (!game) return reply.code(404).send({ error: `No game found for "${req.body.title}"` });

    const { rows } = await pool.query(
      `INSERT INTO wishlist (itad_id, title, target_price_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (itad_id) DO NOTHING
       RETURNING *`,
      [game.id, game.title, toCents(req.body.targetPrice)],
    );
    if (rows.length === 0) return reply.code(409).send({ error: `${game.title} is already on the wishlist` });
    return reply.code(201).send(rows[0]);
  },
);

app.patch<{ Params: { id: number }; Body: { targetPrice: number | null } }>(
  "/wishlist/:id",
  {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } } },
      body: {
        type: "object",
        required: ["targetPrice"],
        properties: { targetPrice: { type: ["number", "null"], minimum: 0 } },
      },
    },
  },
  async (req, reply) => {
    const { rows } = await pool.query(
      // Reset the alert marker so the new target can trigger an alert
      `UPDATE wishlist SET target_price_cents = $2, last_alert_price_cents = NULL
       WHERE id = $1 RETURNING *`,
      [req.params.id, toCents(req.body.targetPrice)],
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });
    return rows[0];
  },
);

app.delete<{ Params: { id: number } }>(
  "/wishlist/:id",
  { schema: { params: { type: "object", properties: { id: { type: "integer" } } } } },
  async (req, reply) => {
    const { rowCount } = await pool.query("DELETE FROM wishlist WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  },
);

// Lowest price per poll run, for charting
app.get<{ Params: { id: number } }>(
  "/wishlist/:id/history",
  { schema: { params: { type: "object", properties: { id: { type: "integer" } } } } },
  async (req) => {
    const { rows } = await pool.query(
      `SELECT fetched_at, min(price_cents) AS price_cents, currency
       FROM price_snapshots
       WHERE game_id = $1
       GROUP BY fetched_at, currency
       ORDER BY fetched_at`,
      [req.params.id],
    );
    return rows;
  },
);

// Discounted offers from each game's most recent poll run
app.get("/deals", async () => {
  const { rows } = await pool.query(`
    SELECT w.id AS game_id, w.title, s.shop, s.price_cents, s.regular_cents,
           s.currency, s.cut, s.url, s.fetched_at
    FROM price_snapshots s
    JOIN wishlist w ON w.id = s.game_id
    WHERE s.cut > 0
      AND s.fetched_at = (SELECT max(fetched_at) FROM price_snapshots WHERE game_id = s.game_id)
    ORDER BY s.cut DESC, s.price_cents`);
  return rows;
});

// Close cleanly on SIGTERM/SIGINT (Docker and Kubernetes send SIGTERM on stop)
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
  });
}

// 0.0.0.0 = listen on all network interfaces, not just localhost
await app.listen({ host: "0.0.0.0", port: config.port });
