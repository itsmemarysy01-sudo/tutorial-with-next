import { Bot, bold, format, InlineKeyboard } from "gramio";
import { autoAnswerCallbackQuery } from "@gramio/auto-answer-callback-query";
import type { ButtonInput, Config } from "./types.ts";
import * as store from "./store.ts";
import { accessDecision, backButton, destinationPicker, ownerMenu } from "./keyboards.ts";
import { formatWhen, isValidUrl, parseWhen } from "./util.ts";
import { publishPost } from "./features/publish.ts";
import { updateButtonEverywhere } from "./features/buttons.ts";
import { broadcastToApproved } from "./features/broadcast.ts";
import { answerQuestion, extractMention } from "./features/assistant.ts";

export function createBot(config: Config) {
  const bot = new Bot(config.botToken).extend(autoAnswerCallbackQuery());
  const isOwner = (id: number | string) => String(id) === config.ownerId;

  // ---- shared helpers ------------------------------------------------------
  async function notifyOwnerOfRequest(userId: string, username?: string) {
    try {
      await bot.api.sendMessage({
        chat_id: config.ownerId,
        text: `New access request from ${username ? "@" + username : userId}`,
        reply_markup: accessDecision(userId),
      });
    } catch (err) {
      console.error("could not notify owner", err);
    }
  }

  /** Non-owner private chat: approval-based access (spec section 10). */
  async function handleUser(userId: string, username: string | undefined, text: string | null) {
    const user = await store.getUser(userId);
    if (user?.status === "approved") {
      return text ? await answerQuestion(text) : "Hi! How can I help you today?";
    }
    if (user?.status === "pending") {
      return "Your access request is still pending. We'll let you know once it's approved.";
    }
    if (user?.status === "declined") {
      return "Sorry, access is currently restricted.";
    }
    await store.requestAccess(userId, username);
    await store.logActivity({ actor: userId, area: "Community", action: "access_requested" });
    await notifyOwnerOfRequest(userId, username);
    return "Thanks! Your access request has been sent to the owner for approval.";
  }

  const promptButtons =
    "Send a button label (e.g. Visit Website), or /skip to continue without buttons.";

  // ---- commands -------------------------------------------------------------
  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const uid = String(ctx.from.id);
    if (isOwner(uid)) {
      await store.clearState(uid);
      return ctx.send(format`${bold("Control Center")}\nWhat would you like to do?`, {
        reply_markup: ownerMenu(),
      });
    }
    if (ctx.chat.type !== "private") return;
    return ctx.send(await handleUser(uid, ctx.from.username, null));
  });

  bot.command("menu", async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id)) return;
    await store.clearState(String(ctx.from.id));
    return ctx.send("Control Center:", { reply_markup: ownerMenu() });
  });

  // Owner runs this inside a group to connect it as a destination.
  bot.command("addhere", async (ctx) => {
    if (!ctx.from || !isOwner(ctx.from.id)) return;
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      return ctx.send("Run /addhere inside the group you want to connect.");
    }
    await store.saveDestination({
      chatId: String(ctx.chat.id),
      title: ctx.chat.title ?? "Untitled group",
      type: "group",
    });
    await store.logActivity({ actor: String(ctx.from.id), area: "Destinations", action: "add", detail: String(ctx.chat.id) });
    return ctx.send("✅ This group is now a connected destination.");
  });

  // Channels/groups register themselves when the bot is made an admin.
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.payload;
    if (update.new_chat_member?.status !== "administrator") return;
    const chat = update.chat;
    const type = chat.type === "channel" ? "channel" : "group";
    await store.saveDestination({ chatId: String(chat.id), title: chat.title ?? String(chat.id), type });
    await store.logActivity({ actor: "telegram", area: "Destinations", action: "auto_add", detail: String(chat.id) });
    try {
      await bot.api.sendMessage({
        chat_id: config.ownerId,
        text: `✅ Connected new destination: "${chat.title ?? chat.id}" (${type}).`,
      });
    } catch { /* owner hasn't opened a DM with the bot yet */ }
  });

  // ---- owner menu -------------------------------------------------------------
  bot.callbackQuery("menu:back", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.clearState(String(ctx.from.id));
    return ctx.editText("Control Center:", { reply_markup: ownerMenu() });
  });

  bot.callbackQuery("cancel", async (ctx) => {
    await store.clearState(String(ctx.from.id));
    return ctx.editText("Cancelled.", isOwner(ctx.from.id) ? { reply_markup: ownerMenu() } : undefined);
  });

  bot.callbackQuery("menu:publish", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.setState(String(ctx.from.id), { step: "compose_text", mode: "publish" });
    return ctx.editText("Send me the text for your post.");
  });

  bot.callbackQuery("menu:schedule", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.setState(String(ctx.from.id), { step: "compose_text", mode: "schedule" });
    return ctx.editText("Send me the text for the post you want to schedule.");
  });

  bot.callbackQuery("menu:destinations", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const dests = await store.listDestinations();
    const kb = new InlineKeyboard();
    for (const d of dests) kb.text(`🗑 ${d.title}`, `destdel:${d.chatId}`).row();
    kb.text("⬅ Back", "menu:back");
    const list = dests.length ? dests.map((d) => `• ${d.title} (${d.type})`).join("\n") : "No destinations yet.";
    return ctx.editText(
      `${list}\n\nChannels: make the bot an admin and it connects automatically.\nGroups: make the bot an admin, then send /addhere inside the group.`,
      { reply_markup: kb },
    );
  });

  bot.callbackQuery(/^destdel:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.deleteDestination(ctx.queryData[1]);
    await store.logActivity({ actor: String(ctx.from.id), area: "Destinations", action: "remove", detail: ctx.queryData[1] });
    return ctx.editText("Removed.", { reply_markup: backButton() });
  });

  // ---- access requests ----------------------------------------------------------
  bot.callbackQuery("menu:access", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const pending = await store.listUsersByStatus("pending");
    if (!pending.length) return ctx.editText("No pending access requests.", { reply_markup: backButton() });
    await ctx.editText(`${pending.length} pending request(s):`, { reply_markup: backButton() });
    for (const u of pending) {
      await ctx.send(`Request from ${u.username ? "@" + u.username : u.userId}`, {
        reply_markup: accessDecision(u.userId),
      });
    }
  });

  bot.callbackQuery(/^acc_(yes|no):(.+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const approve = ctx.queryData[1] === "yes";
    const userId = ctx.queryData[2];
    await store.decideUser(userId, approve);
    await store.logActivity({ actor: String(ctx.from.id), area: "Community", action: approve ? "approve" : "decline", detail: userId });
    await bot.api
      .sendMessage({
        chat_id: userId,
        text: approve ? "✅ You've been approved! Send me a message any time." : "Your access request was declined.",
      })
      .catch(() => {});
    return ctx.editText(approve ? "Approved." : "Declined.");
  });

  // ---- destination picking (shared by publish + schedule) ---------------------------
  bot.callbackQuery(/^dest:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const uid = String(ctx.from.id);
    const st = await store.getState(uid);
    if (!st || st.step !== "compose_destinations") return;
    const sel = new Set(st.destinations ?? []);
    const id = ctx.queryData[1];
    sel.has(id) ? sel.delete(id) : sel.add(id);
    st.destinations = [...sel];
    await store.setState(uid, st);
    return ctx.editText("Choose where to publish:", {
      reply_markup: destinationPicker(await store.listDestinations(), sel),
    });
  });

  bot.callbackQuery("dest_done", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const uid = String(ctx.from.id);
    const st = await store.getState(uid);
    if (!st || st.step !== "compose_destinations") return;
    const destinations = st.destinations ?? [];
    if (!destinations.length) {
      return ctx.answer({ text: "Pick at least one destination first.", show_alert: true });
    }
    if (st.mode === "schedule") {
      await store.setState(uid, { ...st, step: "schedule_time" });
      return ctx.editText(
        `When should it publish? Send a time like 2026-10-01 10:00 (your timezone), or relative: +30m, +2h, +1d.`,
      );
    }
    const r = await publishPost(bot, {
      label: (st.text ?? "").slice(0, 40) || "Untitled",
      text: st.text ?? "",
      buttons: st.buttons ?? [],
      destinations,
      actor: uid,
    });
    await store.clearState(uid);
    return ctx.editText(
      `✅ Published to ${r.sent} destination(s).${r.failed.length ? `\n⚠ Failed: ${r.failed.length}` : ""}`,
      { reply_markup: ownerMenu() },
    );
  });

  // ---- buttons: edit after publishing ---------------------------------------------------
  bot.callbackQuery("menu:buttons", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const posts = await store.listPostsWithButtons(10);
    if (!posts.length) return ctx.editText("No published posts with buttons yet.", { reply_markup: backButton() });
    const kb = new InlineKeyboard();
    for (const p of posts) kb.text(p.label.slice(0, 32), `bp:${p.id}`).row();
    kb.text("⬅ Back", "menu:back");
    return ctx.editText("Pick a post to update its button(s):", { reply_markup: kb });
  });

  bot.callbackQuery(/^bp:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const post = await store.getPost(ctx.queryData[1]);
    if (!post) return ctx.editText("Post not found.", { reply_markup: backButton() });
    const kb = new InlineKeyboard();
    post.buttons.forEach((b, i) => kb.text(`${b.label} → ${b.url}`.slice(0, 60), `bb:${post.id}:${i}`).row());
    kb.text("⬅ Back", "menu:buttons");
    return ctx.editText("Pick a button to update:", { reply_markup: kb });
  });

  bot.callbackQuery(/^bb:(.+):(\d+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.setState(String(ctx.from.id), {
      step: "edit_button_url",
      editPostId: ctx.queryData[1],
      editButtonIdx: Number(ctx.queryData[2]),
    });
    return ctx.editText("Send the new URL for this button.");
  });

  // ---- knowledge base -------------------------------------------------------------------
  bot.callbackQuery("menu:knowledge", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const entries = await store.listKnowledge();
    const kb = new InlineKeyboard();
    for (const e of entries) kb.text(`🗑 ${e.keywords.join(", ")}`.slice(0, 40), `kbdel:${e.id}`).row();
    kb.text("➕ Add answer", "kb_add").row().text("⬅ Back", "menu:back");
    const body = entries.length
      ? entries.map((e) => `• ${e.keywords.join(", ")}\n  → ${e.answer.slice(0, 80)}`).join("\n")
      : "No answers yet. The assistant uses these to reply to users and group @mentions.";
    return ctx.editText(body, { reply_markup: kb });
  });

  bot.callbackQuery("kb_add", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.setState(String(ctx.from.id), { step: "kb_keywords" });
    return ctx.editText("Send trigger keywords, separated by commas (e.g. price, cost, how much).");
  });

  bot.callbackQuery(/^kbdel:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.deleteKnowledge(ctx.queryData[1]);
    await store.logActivity({ actor: String(ctx.from.id), area: "Knowledge", action: "delete", detail: ctx.queryData[1] });
    return ctx.editText("Deleted.", { reply_markup: backButton() });
  });

  // ---- broadcast ---------------------------------------------------------------------------
  bot.callbackQuery("menu:broadcast", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    await store.setState(String(ctx.from.id), { step: "broadcast_text" });
    return ctx.editText("Send the announcement text. It goes to every approved user.");
  });

  bot.callbackQuery("bc_send", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const uid = String(ctx.from.id);
    const st = await store.getState(uid);
    if (!st || st.step !== "broadcast_confirm" || !st.text) return;
    const r = await broadcastToApproved(bot, st.text, uid);
    await store.clearState(uid);
    return ctx.editText(`📨 Sent to ${r.sent} user(s).${r.failed ? ` ⚠ ${r.failed} failed.` : ""}`, {
      reply_markup: ownerMenu(),
    });
  });

  // ---- settings / activity -------------------------------------------------------------------
  bot.callbackQuery("menu:settings", async (ctx) => {
    if (!isOwner(ctx.from.id)) return;
    const upcoming = await store.listScheduled(5);
    const activity = await store.recentActivity(6);
    const up = upcoming.length
      ? upcoming.map((s) => `• ${formatWhen(s.publishAt, config.tzOffsetMinutes)} - ${s.text.slice(0, 30)}`).join("\n")
      : "none";
    const act = activity.length
      ? activity.map((a) => `• ${a.area}/${a.action}${a.detail ? ` (${a.detail})` : ""}`).join("\n")
      : "none yet";
    return ctx.editText(`Owner: ${config.ownerId}\n\nUpcoming posts:\n${up}\n\nRecent activity:\n${act}`, {
      reply_markup: backButton(),
    });
  });

  // ---- free text: owner workflows, user assistance, group mentions ---------------------------------
  bot.on("message", async (ctx) => {
    if (!ctx.from || !ctx.text) return;
    const uid = String(ctx.from.id);
    const text = ctx.text.trim();

    // Group mention assistance (spec sections 8 and 18).
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      const me = await bot.api.getMe();
      const query = me.username ? extractMention(text, me.username) : null;
      if (query !== null) return ctx.send(await answerQuestion(query));
      return;
    }
    if (ctx.chat.type !== "private") return;

    // /skip and /done are part of the compose flow; other commands are handled above.
    if (text.startsWith("/") && text !== "/skip" && text !== "/done") return;

    if (!isOwner(uid)) {
      return ctx.send(await handleUser(uid, ctx.from.username, text));
    }

    const st = await store.getState(uid);
    if (!st) return ctx.send("Control Center:", { reply_markup: ownerMenu() });

    switch (st.step) {
      case "compose_text": {
        if (!text) return ctx.send("Please send some text for the post.");
        await store.setState(uid, { ...st, step: "compose_button_label", text, buttons: [] });
        return ctx.send(promptButtons);
      }

      case "compose_button_label": {
        if (text === "/skip" || text === "/done") {
          const dests = await store.listDestinations();
          if (!dests.length) {
            await store.clearState(uid);
            return ctx.send("No destinations connected yet. Make the bot an admin of a channel or group first.", {
              reply_markup: ownerMenu(),
            });
          }
          await store.setState(uid, { ...st, step: "compose_destinations", destinations: [] });
          return ctx.send("Choose where to publish:", { reply_markup: destinationPicker(dests, new Set()) });
        }
        await store.setState(uid, { ...st, step: "compose_button_url", pendingLabel: text });
        return ctx.send(`Send the URL for the "${text}" button (https://...).`);
      }

      case "compose_button_url": {
        if (!isValidUrl(text)) return ctx.send("That doesn't look like a valid URL. It must start with https://");
        const buttons: ButtonInput[] = [...(st.buttons ?? []), { label: st.pendingLabel ?? "Open", url: text }];
        await store.setState(uid, { ...st, step: "compose_button_label", buttons, pendingLabel: undefined });
        return ctx.send("Button added. Send another button label, or /done to continue.");
      }

      case "schedule_time": {
        const when = parseWhen(text, config.tzOffsetMinutes);
        if (!when || when <= Date.now()) {
          return ctx.send("I couldn't read that time, or it's in the past. Try 2026-10-01 10:00 or +30m.");
        }
        const s = await store.addScheduled({
          text: st.text ?? "",
          buttons: st.buttons ?? [],
          destinations: st.destinations ?? [],
          publishAt: when,
        });
        await store.logActivity({ actor: uid, area: "Schedule", action: "create", detail: `${s.id} at ${new Date(when).toISOString()}` });
        await store.clearState(uid);
        return ctx.send(`⏰ Scheduled for ${formatWhen(when, config.tzOffsetMinutes)}.`, { reply_markup: ownerMenu() });
      }

      case "edit_button_url": {
        if (!isValidUrl(text)) return ctx.send("That doesn't look like a valid URL. It must start with https://");
        const r = await updateButtonEverywhere(bot, st.editPostId ?? "", st.editButtonIdx ?? -1, text, uid);
        await store.clearState(uid);
        if (!r.found) return ctx.send("I couldn't find that button any more.", { reply_markup: ownerMenu() });
        return ctx.send(`✅ Updated on ${r.updated} message(s).${r.failed ? ` ⚠ ${r.failed} failed.` : ""}`, {
          reply_markup: ownerMenu(),
        });
      }

      case "kb_keywords": {
        const keywords = text.split(",").map((k) => k.trim()).filter(Boolean);
        if (!keywords.length) return ctx.send("Send at least one keyword.");
        await store.setState(uid, { step: "kb_answer", keywords });
        return ctx.send("Now send the answer the bot should give when those keywords appear.");
      }

      case "kb_answer": {
        const entry = await store.addKnowledge(st.keywords ?? [], text);
        await store.logActivity({ actor: uid, area: "Knowledge", action: "add", detail: entry.id });
        await store.clearState(uid);
        return ctx.send("✅ Saved.", { reply_markup: ownerMenu() });
      }

      case "broadcast_text": {
        await store.setState(uid, { step: "broadcast_confirm", text });
        return ctx.send(`Send this to all approved users?\n\n${text}`, {
          reply_markup: new InlineKeyboard().text("📨 Send", "bc_send").text("✖ Cancel", "cancel"),
        });
      }

      default:
        return ctx.send("Control Center:", { reply_markup: ownerMenu() });
    }
  });

  return bot;
}

export type AppBot = ReturnType<typeof createBot>;
