import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.warn(`متغير البيئة "${name}" غير موجود في ملف .env`);
    return "";
  }
  return value;
}

export const config = {
  token: process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  clientSecret: process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_BOT_CLIENT_SECRET || "",
  databaseUrl: required("DATABASE_URL"),
  dbSslRootCertPath: process.env.DB_SSL_CA_PATH ?? "",
  devGuildId: process.env.DEV_GUILD_ID ?? "",
  dashboardUrl: process.env.DASHBOARD_URL ?? "http://localhost:3000",
  defaultColor: 0x315c43,
  // مفاتيح الخدمات الخارجية تُقرأ من البيئة فقط — لا قيم افتراضية مكتوبة في الكود
  tmdbApiKey: process.env.TMDB_API_KEY ?? "",
  omdbApiKey: process.env.OMDB_API_KEY ?? "",
  deeplApiKey: process.env.DEEPL_API_KEY ?? ""
};
