import { listKnowledge } from "../store.ts";

/** Returns the text after removing "@botname", or null if not mentioned. */
export function extractMention(text: string, botUsername: string): string | null {
  const tag = `@${botUsername}`.toLowerCase();
  const i = text.toLowerCase().indexOf(tag);
  if (i === -1) return null;
  return (text.slice(0, i) + text.slice(i + tag.length)).trim();
}

/**
 * Business assistance (private chats for approved users, and @mentions in
 * groups). Answers come from the owner's Knowledge base; if nothing matches
 * it falls back to a polite hand-off.
 */
export async function answerQuestion(query: string): Promise<string> {
  const q = query.toLowerCase().trim();
  if (!q) return "Hi! How can I help you today?";

  const entries = await listKnowledge();
  let best: { score: number; answer: string } | null = null;
  for (const e of entries) {
    const score = e.keywords.filter((k) => k && q.includes(k.toLowerCase())).length;
    if (score > 0 && (!best || score > best.score)) best = { score, answer: e.answer };
  }
  if (best) return best.answer;

  return `Thanks for asking about "${query}" - a member of the team will follow up shortly.`;
}
