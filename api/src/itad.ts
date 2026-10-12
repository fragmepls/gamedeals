import { config } from "./config.ts";

const BASE_URL = "https://api.isthereanydeal.com";

export type ItadGame = { id: string; title: string };

export async function lookupGame(title: string): Promise<ItadGame | null> {
  const url = `${BASE_URL}/games/lookup/v1?title=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "ITAD-API-Key": config.itadApiKey } });
  if (!res.ok) throw new Error(`ITAD lookup failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { found: boolean; game?: ItadGame };
  return body.found && body.game ? { id: body.game.id, title: body.game.title } : null;
}
