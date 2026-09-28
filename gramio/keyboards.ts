import { InlineKeyboard } from "gramio";
import type { ButtonInput, Destination } from "./types.ts";

/** Owner control center (spec section 6, "Owner Experience"). */
export function ownerMenu() {
  return new InlineKeyboard()
    .text("📢 Publish", "menu:publish")
    .text("⏰ Schedule", "menu:schedule")
    .row()
    .text("🔗 Buttons", "menu:buttons")
    .text("📣 Destinations", "menu:destinations")
    .row()
    .text("👥 Access", "menu:access")
    .text("📚 Knowledge", "menu:knowledge")
    .row()
    .text("📨 Broadcast", "menu:broadcast")
    .text("⚙️ Settings", "menu:settings");
}

export const backButton = () => new InlineKeyboard().text("⬅ Back", "menu:back");

export function destinationPicker(dests: Destination[], selected: Set<string>) {
  const kb = new InlineKeyboard();
  for (const d of dests) {
    kb.text(`${selected.has(d.chatId) ? "☑" : "☐"} ${d.title}`, `dest:${d.chatId}`).row();
  }
  return kb.text("✅ Done", "dest_done").text("✖ Cancel", "cancel");
}

export function accessDecision(userId: string) {
  return new InlineKeyboard()
    .text("✅ Approve", `acc_yes:${userId}`)
    .text("🚫 Decline", `acc_no:${userId}`);
}

/** Post buttons: one URL button per row. */
export function postKeyboard(buttons: ButtonInput[]) {
  const kb = new InlineKeyboard();
  buttons.forEach((b, i) => {
    kb.url(b.label, b.url);
    if (i < buttons.length - 1) kb.row();
  });
  return kb;
}
