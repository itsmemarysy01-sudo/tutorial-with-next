export interface Config {
  botToken: string;
  ownerId: string;
  webhookSecret: string;
  tzOffsetMinutes: number;
}

export interface ButtonInput {
  label: string;
  url: string;
}

export interface Destination {
  chatId: string;
  title: string;
  type: "channel" | "group";
  addedAt: number;
}

export interface Post {
  id: string;
  label: string;
  text: string;
  buttons: ButtonInput[];
  createdAt: number;
}

export interface ScheduledPost {
  id: string;
  text: string;
  buttons: ButtonInput[];
  destinations: string[];
  publishAt: number; // epoch ms
  createdAt: number;
}

export interface UserRecord {
  userId: string;
  username?: string;
  status: "pending" | "approved" | "declined";
  requestedAt: number;
  decidedAt?: number;
}

export interface KnowledgeEntry {
  id: string;
  keywords: string[];
  answer: string;
}

/** Workflow-purpose doc: "Activity Recording" step of every workflow. */
export interface ActivityEntry {
  at: number;
  actor: string;
  area: string; // Content | Schedule | Buttons | Community | Broadcast | Knowledge | ...
  action: string;
  detail?: string;
}

export type Step =
  | "compose_text"
  | "compose_button_label"
  | "compose_button_url"
  | "compose_destinations"
  | "schedule_time"
  | "edit_button_url"
  | "kb_keywords"
  | "kb_answer"
  | "broadcast_text"
  | "broadcast_confirm";

/** Ephemeral per-user workflow state (auto-expires - see store.ts). */
export interface StateData {
  step: Step;
  text?: string;
  buttons?: ButtonInput[];
  pendingLabel?: string;
  destinations?: string[];
  mode?: "publish" | "schedule";
  editPostId?: string;
  editButtonIdx?: number;
  keywords?: string[];
}
