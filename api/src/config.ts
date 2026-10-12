function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  itadApiKey: required("ITAD_API_KEY"),
  port: Number(process.env.PORT ?? 3000),
};
