/**
 * What the secretary is, independent of which model runs it.
 *
 * The chat/tool shapes and the system prompt live here so more than one brain
 * can implement the same contract. Everything a brain receives is ALREADY
 * pseudonymized (see secretaryPrivacy) — no real client name, number, address
 * or message body ever reaches a model, whichever vendor it belongs to.
 */

import { useSettings } from '../store/settings';
import type { SecretaryAction } from './secretaryTools';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  /** Epoch ms. */
  at: number;
  /**
   * Real client names this answer referred to, resolved on-device after the
   * labels are mapped back. Powers the one-tap "Message X" chips — never sent
   * anywhere, purely a local display aid.
   */
  mentions?: string[];
  /**
   * Things the model PROPOSED during this turn — a suggested message, a
   * suggested booking. Nothing has happened: the user confirms each one on
   * the screen it belongs to. Filled in on-device (labels mapped back to
   * real names) and, like `mentions`, never sent back to the API.
   */
  actions?: SecretaryAction[];
}

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<
    string,
    { type: 'string' | 'number' | 'integer' | 'boolean'; description?: string }
  >;
  required?: string[];
}

/** A function the model may call. Execution happens in `onToolCall`. */
export interface ToolSpec {
  name: string;
  description: string;
  /** Omit for no-argument tools. */
  parameters?: ToolParameterSchema;
}

/** Runs one tool locally and returns whatever the model should see. */
export type ToolRunner = (
  name: string,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

/** Typed outcome — askSecretary never throws. */
export type SecretaryOutcome =
  | { ok: true; text: string; toolsUsed: string[] }
  | { ok: false; error: string };

export const SYSTEM_INSTRUCTION = [
  'You are the scheduling assistant for a sole proprietor who runs paid client meetings booked over text.',
  'Clients are referred to ONLY by pseudonymous labels ("Client 1", "Client 2"). You never see real names or phone numbers, and you must never ask for them or guess at them.',
  'Be concise and practical: short answers, plain sentences, no preamble, no bullet lists unless the user asks for a list.',
  'Never invent clients, meetings, bookings, amounts or history. If a tool returns nothing, say so plainly.',
  'Use the tools for every factual claim about the schedule, money or clients — do not answer those from memory.',
  'When you suggest contacting someone, ALWAYS say why: their usual rhythm is overdue, they have an unanswered message, they owe an outstanding balance, or a gap is about to go unfilled.',
  'Times from tools are minutes from midnight (540 = 9:00 AM); dates are "YYYY-MM-DD". Convert them to friendly times and day names in your answer.',
  'Money is in the user\'s own currency; report amounts exactly as the tools give them.',
  'When get_conversation is available, USE IT before you recommend contacting anyone, explain why someone went quiet, or draft a message to them. Call it for each person you are about to talk about. Timing tells you that a thread stalled; only the words tell you why, and the why is the entire value of the suggestion.',
  'Never characterize what someone wants, agreed to, or objected to unless you have read that thread in this conversation. If you have not read it, say what you actually know: that they have been quiet since a given time.',
  'When you have read a thread, ground the suggestion in it: what they last asked for, the day or time they floated, the price they hesitated over. Summarize in your own words and quote at most a short phrase.',
  'When you draft a message, match how the user actually writes to that person, based on their own past messages.',
  'Message history has two sides. Every message carries who wrote it ("speaker", or "lastFrom" on unanswered rows): the client label, or "you" for the user. Check it before you characterize anything. Quoting the user their own words as though a client said them, or crediting the client with what the user wrote, is worse than saying nothing.',
  'For anything that spans clients — who is asking about a day, who mentioned a price, who was never answered — use search_messages or scan_conversations rather than guessing or checking one thread at a time. These read the whole inbox, both channels, both directions.',
  'Those tools cap what they return and say so when they dropped something. If a result reports conversations it left out, tell the user your answer covers only part of the inbox. Never present a capped scan as if it were everything.',
  'A client whose status is "blocked" was deliberately cut off by the user. Never suggest contacting them, never draft to them, never propose a booking with them, and leave them out of any list of people to reach out to. Answer questions about them if asked directly, but say that they are blocked.',
  'draft_message and propose_booking do NOT send or book anything — they only prepare something for the user to review. Never say you have sent a message or booked a meeting; say a draft or a suggested time is waiting for them to confirm.',
].join(' ');

/**
 * The model has no clock. A scheduling assistant that does not know today's
 * date cannot resolve "tomorrow evening" or pass a sensible date to
 * get_schedule, so the current moment is stamped into the system instruction
 * on every request (in the user's own timezone, not UTC).
 */
export function systemInstructionNow(): string {
  const readsMessages = useSettings.getState().settings.secretaryReadsMessages;
  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const minutes = now.getHours() * 60 + now.getMinutes();
  return [
    SYSTEM_INSTRUCTION,
    readsMessages
      ? 'You CAN read the text of messages: it arrives in tool results, with names, numbers, emails and addresses already replaced. Reason from what was actually said.'
      : 'You cannot see the text of any message, only when it was sent. Never guess at wording or claim to know what someone said.',
    `Right now it is ${weekday}, ${y}-${m}-${d}, ${minutes} minutes past midnight local time.`,
    'Resolve "today", "tomorrow", "this evening" and weekday names against that, and pass real YYYY-MM-DD dates to tools.',
  ].join(' ');
}
