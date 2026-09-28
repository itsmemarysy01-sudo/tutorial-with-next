import type {
  ActivityEntry,
  ButtonInput,
  Destination,
  KnowledgeEntry,
  Post,
  ScheduledPost,
  StateData,
  UserRecord,
} from "./types.ts";

// Deno KV works on Deno Deploy (globally replicated) and locally (SQLite file).
let _kv: Deno.Kv | undefined;
async function kv(): Promise<Deno.Kv> {
  return (_kv ??= await Deno.openKv());
}

export const newId = () => crypto.randomUUID().slice(0, 8);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Destinations (channels / groups the owner has connected)
// ---------------------------------------------------------------------------
export async function saveDestination(d: Omit<Destination, "addedAt">) {
  await (await kv()).set(["destinations", d.chatId], { ...d, addedAt: Date.now() });
}

export async function listDestinations(): Promise<Destination[]> {
  const out: Destination[] = [];
  for await (const e of (await kv()).list<Destination>({ prefix: ["destinations"] })) {
    out.push(e.value);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export async function deleteDestination(chatId: string) {
  await (await kv()).delete(["destinations", chatId]);
}

// ---------------------------------------------------------------------------
// Posts, the messages they were published as, and their buttons
// ---------------------------------------------------------------------------
export async function createPost(label: string, text: string, buttons: ButtonInput[]): Promise<Post> {
  const post: Post = { id: newId(), label, text, buttons, createdAt: Date.now() };
  await (await kv()).set(["posts", post.id], post);
  return post;
}

export async function getPost(id: string): Promise<Post | null> {
  return (await (await kv()).get<Post>(["posts", id])).value;
}

export async function listPostsWithButtons(limit = 10): Promise<Post[]> {
  const out: Post[] = [];
  for await (const e of (await kv()).list<Post>({ prefix: ["posts"] })) {
    if (e.value.buttons.length > 0) out.push(e.value);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export async function setPostButtonUrl(postId: string, idx: number, url: string): Promise<Post | null> {
  const post = await getPost(postId);
  if (!post || !post.buttons[idx]) return null;
  post.buttons[idx] = { ...post.buttons[idx], url };
  await (await kv()).set(["posts", postId], post);
  return post;
}

export async function addPostMessage(postId: string, chatId: string, messageId: number) {
  await (await kv()).set(["post_messages", postId, chatId, messageId], true);
}

export async function listPostMessages(postId: string) {
  const out: { chatId: string; messageId: number }[] = [];
  for await (const e of (await kv()).list({ prefix: ["post_messages", postId] })) {
    out.push({ chatId: String(e.key[2]), messageId: Number(e.key[3]) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scheduled posts. Key = ["scheduled", publishAt, id] so KV returns them in
// time order and "everything due" is a simple range read.
// ---------------------------------------------------------------------------
export async function addScheduled(p: Omit<ScheduledPost, "id" | "createdAt">): Promise<ScheduledPost> {
  const full: ScheduledPost = { ...p, id: newId(), createdAt: Date.now() };
  await (await kv()).set(["scheduled", full.publishAt, full.id], full);
  return full;
}

export async function listScheduled(limit = 20): Promise<ScheduledPost[]> {
  const out: ScheduledPost[] = [];
  for await (const e of (await kv()).list<ScheduledPost>({ prefix: ["scheduled"] }, { limit })) {
    out.push(e.value);
  }
  return out;
}

/**
 * Atomically claims (deletes) every scheduled post that is due and returns
 * them. Because the delete is a compare-and-swap, two overlapping cron runs
 * can never publish the same post twice.
 */
export async function claimDueScheduled(now = Date.now()): Promise<ScheduledPost[]> {
  const db = await kv();
  const claimed: ScheduledPost[] = [];
  for await (
    const e of db.list<ScheduledPost>({ prefix: ["scheduled"], end: ["scheduled", now + 1] }, { limit: 25 })
  ) {
    const res = await db.atomic().check(e).delete(e.key).commit();
    if (res.ok) claimed.push(e.value);
  }
  return claimed;
}

// ---------------------------------------------------------------------------
// Users / access requests
// ---------------------------------------------------------------------------
export async function getUser(userId: string): Promise<UserRecord | null> {
  return (await (await kv()).get<UserRecord>(["users", userId])).value;
}

export async function requestAccess(userId: string, username?: string) {
  const existing = await getUser(userId);
  if (existing) return existing;
  const rec: UserRecord = { userId, username, status: "pending", requestedAt: Date.now() };
  await (await kv()).set(["users", userId], rec);
  return rec;
}

export async function decideUser(userId: string, approve: boolean) {
  const rec = await getUser(userId);
  if (!rec) return;
  rec.status = approve ? "approved" : "declined";
  rec.decidedAt = Date.now();
  await (await kv()).set(["users", userId], rec);
}

export async function listUsersByStatus(status: UserRecord["status"]): Promise<UserRecord[]> {
  const out: UserRecord[] = [];
  for await (const e of (await kv()).list<UserRecord>({ prefix: ["users"] })) {
    if (e.value.status === status) out.push(e.value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ephemeral workflow state. Expires on its own after an hour of inactivity:
// "Temporary information -> expire" (privacy principle in the spec).
// ---------------------------------------------------------------------------
export async function setState(userId: string, data: StateData) {
  await (await kv()).set(["state", userId], data, { expireIn: HOUR });
}

export async function getState(userId: string): Promise<StateData | null> {
  return (await (await kv()).get<StateData>(["state", userId])).value;
}

export async function clearState(userId: string) {
  await (await kv()).delete(["state", userId]);
}

// ---------------------------------------------------------------------------
// Knowledge base (used by the business assistant)
// ---------------------------------------------------------------------------
export async function addKnowledge(keywords: string[], answer: string): Promise<KnowledgeEntry> {
  const entry: KnowledgeEntry = { id: newId(), keywords, answer };
  await (await kv()).set(["knowledge", entry.id], entry);
  return entry;
}

export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  const out: KnowledgeEntry[] = [];
  for await (const e of (await kv()).list<KnowledgeEntry>({ prefix: ["knowledge"] })) {
    out.push(e.value);
  }
  return out;
}

export async function deleteKnowledge(id: string) {
  await (await kv()).delete(["knowledge", id]);
}

// ---------------------------------------------------------------------------
// Activity log ("Activity Recording" step of the workflow lifecycle).
// Kept 30 days, then expires automatically.
// ---------------------------------------------------------------------------
export async function logActivity(entry: Omit<ActivityEntry, "at">) {
  const at = Date.now();
  await (await kv()).set(["activity", at, newId()], { ...entry, at }, { expireIn: 30 * DAY });
}

export async function recentActivity(limit = 8): Promise<ActivityEntry[]> {
  const out: ActivityEntry[] = [];
  for await (const e of (await kv()).list<ActivityEntry>({ prefix: ["activity"] }, { reverse: true, limit })) {
    out.push(e.value);
  }
  return out;
}
