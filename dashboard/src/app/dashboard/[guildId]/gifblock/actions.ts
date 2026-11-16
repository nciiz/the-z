"use server";

import { revalidatePath } from "next/cache";
import { GuildConfig, GifBlock } from "@thez/shared";
import { ensureDb } from "@/lib/db";
import { requireGuildAdmin } from "@/lib/guildAccess";
import { logAction, logError, summarizeConfig } from "@/lib/logger";

export interface GifBlockInput {
  enabled: boolean;
  logChannelId: string;
  whitelistRoleIds: string[];
  whitelistChannelIds: string[];
  gifBlocks: Array<{
    id: string;
    url: string;
    action: "delete" | "warn" | "mute" | "kick" | "ban";
    duration: number;
    reason: string;
    enabled: boolean;
  }>;
}

export async function saveGifBlockConfig(guildId: string, input: GifBlockInput) {
  // فحص الصلاحيات داخل الـ Server Action نفسه — لا يكفي حارس الصفحة، لأن الإجراء
  // قابل للاستدعاء كطلب مستقل من أي عميل يعرف معرّف السيرفر.
  const session = await requireGuildAdmin(guildId);
  await ensureDb();

  // Update guild config
  await GuildConfig.findOneAndUpdate(
    { guildId },
    {
      $set: {
        "gifBlock.enabled": input.enabled,
        "gifBlock.logChannelId": input.logChannelId,
        "gifBlock.whitelistRoleIds": input.whitelistRoleIds,
        "gifBlock.whitelistChannelIds": input.whitelistChannelIds,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  // Handle GIF blocks
  const existingBlocks = await GifBlock.find({ guildId });
  const existingIds = new Set(existingBlocks.map(b => b._id?.toString()));

  // نعيد القائمة النهائية للعميل حتى يستبدل المعرّفات المؤقتة (Date.now)
  // بمعرّفات الصفوف الحقيقية، فلا تتكرر الكتل عند الحفظ أكثر من مرة.
  const savedBlocks: GifBlockInput["gifBlocks"] = [];

  // Update or create blocks
  for (const block of input.gifBlocks) {
    if (existingIds.has(block.id)) {
      // يجب أن يظل معرّف السيرفر ضمن شرط التحديث حتى لا يمكن تعديل صف
      // يخص سيرفرًا آخر عبر إرسال معرّفه في الحمولة.
      await GifBlock.findOneAndUpdate(
        { _id: block.id, guildId },
        {
          $set: {
            url: block.url,
            action: block.action,
            duration: block.duration,
            reason: block.reason,
            enabled: block.enabled
          }
        }
      );
      savedBlocks.push(block);
      existingIds.delete(block.id);
    } else {
      const created = await GifBlock.create({
        guildId,
        url: block.url,
        action: block.action,
        duration: block.duration,
        reason: block.reason,
        enabled: block.enabled,
        addedBy: "dashboard", // You might want to track the actual user
        addedAt: new Date()
      });
      savedBlocks.push({ ...block, id: created._id?.toString() || block.id });
    }
  }

  // Delete removed blocks — مقيّدة بالسيرفر الحالي أيضًا
  for (const id of existingIds) {
    await GifBlock.deleteOne({ _id: id, guildId });
  }

  logAction({
    label: "gifblock/save",
    guildId,
    userId: (session.user as any).id,
    userName: session.user?.name ?? undefined,
    action: "حفظ إعدادات حظر GIFs",
    details: summarizeConfig(input as unknown as Record<string, unknown>)
  });

  revalidatePath(`/dashboard/${guildId}/gifblock`);
  return { gifBlocks: savedBlocks };
}