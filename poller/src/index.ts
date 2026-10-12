// One-shot: fetch prices for every wishlisted game, store them, send alerts, exit.
import pg from "pg";
import { config } from "./config.ts";
import { fetchPrices, type Deal } from "./itad.ts";
import { sendAlert } from "./discord.ts";

type WishlistRow = {
  id: number;
  itad_id: string;
  title: string;
  target_price_cents: number | null;
  last_alert_price_cents: number | null;
};

const pool = new pg.Pool({ connectionString: config.databaseUrl });

const formatPrice = (p: Deal["price"]) => `${p.amount.toFixed(2)} ${p.currency}`;

async function main() {
  const { rows: games } = await pool.query<WishlistRow>(
    "SELECT id, itad_id, title, target_price_cents, last_alert_price_cents FROM wishlist",
  );
  if (games.length === 0) {
    console.log("Wishlist is empty, nothing to do");
    return;
  }

  const prices = await fetchPrices(games.map((g) => g.itad_id));
  const pricesById = new Map(prices.map((p) => [p.id, p]));

  // One transaction: now() is the transaction start time, so all rows of this run share fetched_at
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const game of games) {
      const gamePrices = pricesById.get(game.itad_id);
      if (!gamePrices) continue;
      for (const deal of gamePrices.deals) {
        await client.query(
          `INSERT INTO price_snapshots (game_id, shop, price_cents, regular_cents, currency, cut, url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [game.id, deal.shop.name, deal.price.amountInt, deal.regular.amountInt,
           deal.price.currency, deal.cut, deal.url],
        );
      }
      await client.query("UPDATE wishlist SET history_low_cents = $2 WHERE id = $1", [
        game.id,
        gamePrices.historyLow?.all?.amountInt ?? null,
      ]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  let alerts = 0;
  for (const game of games) {
    const gamePrices = pricesById.get(game.itad_id);
    if (!gamePrices || gamePrices.deals.length === 0) continue;

    const best = gamePrices.deals.reduce((a, b) => (b.price.amountInt < a.price.amountInt ? b : a));
    const historyLow = gamePrices.historyLow?.all?.amountInt;

    const reasons: string[] = [];
    if (game.target_price_cents != null && best.price.amountInt <= game.target_price_cents) {
      reasons.push("hit your target price");
    }
    if (historyLow != null && best.price.amountInt <= historyLow) {
      reasons.push("is at its historic low");
    }

    if (reasons.length === 0) {
      // Price went back up: clear the marker so the next drop alerts again
      if (game.last_alert_price_cents != null) {
        await pool.query("UPDATE wishlist SET last_alert_price_cents = NULL WHERE id = $1", [game.id]);
      }
      continue;
    }
    // Only alert again if the price dropped further since the last alert
    if (game.last_alert_price_cents != null && best.price.amountInt >= game.last_alert_price_cents) {
      continue;
    }

    await sendAlert(
      `**${game.title}** ${reasons.join(" and ")}: ${formatPrice(best.price)} at ${best.shop.name} (-${best.cut}%)\n${best.url}`,
    );
    await pool.query("UPDATE wishlist SET last_alert_price_cents = $2 WHERE id = $1", [
      game.id,
      best.price.amountInt,
    ]);
    alerts++;
  }

  console.log(`Polled ${games.length} games, stored prices, sent ${alerts} alerts`);
}

// Non-zero exit code on failure, so a scheduler (later: K8s CronJob) can see the run failed
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
