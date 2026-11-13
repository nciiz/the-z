import { NextAuthOptions } from "next-auth";
import DiscordProvider from "next-auth/providers/discord";

async function refreshDiscordToken(refreshToken: string) {
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  return {
    accessToken: data.access_token as string,
    refreshToken: (data.refresh_token ?? refreshToken) as string,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in as number)
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      issuer: "https://discord.com",
      authorization: { params: { scope: "identify guilds" } }
    })
  ],
  session: { 
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60 // 30 days
  },
  callbacks: {
    async jwt({ token, account }) {
      // تسجيل دخول أول مرة
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.error = undefined;
        // معرّف مستخدم Discord — يصل كـ sub في توكن JWT لاستراتيجية jwt
        token.userId = token.sub ?? account.providerAccountId;
        return token;
      }

      // التوكن لم ينتهِ بعد
      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token;
      }

      // التوكن انتهى — نحاول تجديده
      if (token.refreshToken) {
        const refreshed = await refreshDiscordToken(token.refreshToken as string);
        if (refreshed) {
          return {
            ...token,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
            error: undefined
          };
        }
      }

      // فشل التجديد — نبقي التوكن القديم ونضع علامة خطأ
      return { ...token, error: "RefreshFailed" };
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).error = token.error;
      if (session.user && (token as any).userId) {
        (session.user as any).id = (token as any).userId;
      }
      return session;
    }
  },
  pages: {
    signIn: "/"
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: false
};
