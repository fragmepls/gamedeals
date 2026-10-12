import { config } from "./config.ts";

export async function sendAlert(message: string): Promise<void> {
  if (!config.discordWebhookUrl) {
    console.log(`[alert, no webhook configured] ${message}`);
    return;
  }
  const res = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
}
