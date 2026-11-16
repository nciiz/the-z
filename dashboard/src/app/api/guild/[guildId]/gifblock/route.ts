import { NextRequest, NextResponse } from "next/server";
import { requireApiGuild } from "@/lib/apiAuth";
import { apiRateLimiter } from "@/lib/rateLimit";
import { saveGifBlockConfig, GifBlockInput } from "@/app/dashboard/[guildId]/gifblock/actions";

export async function POST(request: NextRequest, { params }: { params: { guildId: string } }) {
  const access = await requireApiGuild(params.guildId);
  if (!access.ok) return access.response;

  const rate = apiRateLimiter.check(`${access.userId}:${params.guildId}:gifblock`);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "طلبات كثيرة جداً — حاول لاحقاً" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) }
      }
    );
  }

  try {
    const body: GifBlockInput = await request.json();
    const result = await saveGifBlockConfig(params.guildId, body);
    return NextResponse.json({ success: true, gifBlocks: result.gifBlocks });
  } catch (error) {
    console.error("Failed to save GIF block config:", error);
    return NextResponse.json(
      { error: "فشل حفظ الإعدادات" },
      { status: 500 }
    );
  }
}