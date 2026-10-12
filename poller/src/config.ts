function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  itadApiKey: required("ITAD_API_KEY"),
  country: process.env.ITAD_COUNTRY ?? "US",
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
};
