import { config } from "./config.ts";

const BASE_URL = "https://api.isthereanydeal.com";
const MAX_IDS_PER_REQUEST = 200;

type Price = { amount: number; amountInt: number; currency: string };

export type Deal = {
  shop: { id: number; name: string };
  price: Price;
  regular: Price;
  cut: number;
  url: string;
};

export type GamePrices = {
  id: string;
  historyLow: { all: Price | null } | null;
  deals: Deal[];
};

export async function fetchPrices(itadIds: string[]): Promise<GamePrices[]> {
  const results: GamePrices[] = [];
  for (let i = 0; i < itadIds.length; i += MAX_IDS_PER_REQUEST) {
    const url = `${BASE_URL}/games/prices/v3?country=${config.country}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "ITAD-API-Key": config.itadApiKey, "Content-Type": "application/json" },
      body: JSON.stringify(itadIds.slice(i, i + MAX_IDS_PER_REQUEST)),
    });
    if (!res.ok) throw new Error(`ITAD prices failed: ${res.status} ${await res.text()}`);
    results.push(...((await res.json()) as GamePrices[]));
  }
  return results;
}
