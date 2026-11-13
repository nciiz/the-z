import { ExtendedClient } from "../client";
import { componentRouter } from "../handlers/componentRouter";
import { registerTicketComponents } from "./tickets/ticketManager";
import { registerTempVoiceComponents } from "./tempVoice/voiceManager";
import { registerColorComponents } from "./roles/colorRoles";
import { registerSelfRoleComponents } from "./roles/selfRoles";
import { expirePendingCaptchas, registerCaptchaComponents } from "./captcha/captcha";
import { registerXpScheduler } from "./leveling/xpManager";
import { startJailExpiryInterval } from "./jail/expiry";
import { startAlwaysVoiceLoop } from "./alwaysVoice/alwaysVoiceManager";
import { startMemberCounter } from "./memberCounter/memberCounterManager";
import { scanScheduledMessages } from "./scheduledMessages/scheduledMessagesManager";
import { registerReactionRoles } from "./reactionRoles/reactionRolesManager";
import { scanIslamicDue } from "./islamicContent/islamicContentManager";
import { registerSuggestionComponents } from "./suggestions/suggestionManager";
import { registerMovieComponents } from "./movies/moviesManager";
import { flushAfkMentions } from "../utils/afkBatch";
import { flushVotes } from "./suggestions/voteStore";
import { registerAnalyticsScheduler } from "./analytics/analytics";
import { registerHeartbeatScheduler } from "./health/heartbeat";
import { registerFlushHandler, registerRecurring, startScheduler } from "../scheduler/scheduler";

/** نقطة تجميع مركزية: تسجّل كل معالجات الأزرار/القوائم الخاصة بكل موديول، وتشغّل المهام الدورية */
export function registerAllModules(client: ExtendedClient) {
  registerTicketComponents(componentRouter);
  registerTempVoiceComponents(componentRouter);
  registerColorComponents(componentRouter);
  registerSelfRoleComponents(componentRouter);
  registerCaptchaComponents(componentRouter);
  registerSuggestionComponents(componentRouter);
  registerMovieComponents(componentRouter);
  registerReactionRoles(client);

  client.once("ready", () => {
    // كل المهام الدورية تمر عبر المجدول المركزي الوحيد — لا مؤقتات متفرقة
    registerXpScheduler(client);
    registerAnalyticsScheduler();
    registerHeartbeatScheduler(client);
    registerRecurring("afk-flush", 30_000, async () => {
      await flushAfkMentions();
    });
    registerRecurring("scheduled-messages", 30_000, scanScheduledMessages);
    registerRecurring("islamic-due", 15_000, scanIslamicDue);
    registerRecurring("captcha-expiry", 30_000, () => expirePendingCaptchas(client));
    registerFlushHandler("afk", () => flushAfkMentions());
    registerFlushHandler("suggestion-votes", () => flushVotes());
    startScheduler(client);

    startJailExpiryInterval(client);
    startAlwaysVoiceLoop(client);
    startMemberCounter(client);
  });
}
