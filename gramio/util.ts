/** Validation step of the workflow lifecycle. */
export function isValidUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "tg:";
  } catch {
    return false;
  }
}

/**
 * Parses "2026-10-01 10:00" (interpreted in the owner's timezone) or a
 * relative "+30m" / "+2h" / "+1d". Returns epoch ms or null.
 */
export function parseWhen(input: string, tzOffsetMinutes: number): number | null {
  const s = input.trim();
  const rel = s.match(/^\+(\d+)([mhd])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return Date.now() + n * ms;
  }
  const abs = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!abs) return null;
  const [, y, mo, d, h, mi] = abs.map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  return utc - tzOffsetMinutes * 60_000;
}

export function formatWhen(epochMs: number, tzOffsetMinutes: number): string {
  const d = new Date(epochMs + tzOffsetMinutes * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const sign = tzOffsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMinutes);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} (UTC${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)})`;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import type { Bot } from "gramio";
/** Features only need the raw API, so accept any (plugin-extended) bot. */
export type BotLike = Pick<Bot, "api">;
