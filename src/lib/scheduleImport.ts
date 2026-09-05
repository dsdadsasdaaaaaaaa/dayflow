import type { DayKey } from '../types';
import { todayKey } from './dates';
import { loadBrain, type BrainChoice } from './secretaryBrain';

/**
 * Turning a school's weekly schedule email into a week of DayFlow.
 *
 * Every school writes these differently — a table, a list, a wall of prose —
 * and the format changes whenever someone redesigns the newsletter. A parser
 * written against one shape breaks silently the first time that happens, and
 * a silent break here means missing a class. So the reading is done by the
 * model the user has already connected, and the checking is done here: every
 * field is validated on device, and anything that fails is dropped rather
 * than guessed at.
 *
 * Nothing is created without being shown first. The model is reading an
 * email, which is exactly the kind of input that can be wrong or hostile,
 * so its output is a PROPOSAL — the import screen is the confirmation.
 *
 * Unlike the secretary this does not pseudonymize: a timetable is the user's
 * own school week, with no client, number or message in it. If that ever
 * stops being true, this is the comment that was wrong.
 */

/** One class or event the model found. Dates are already resolved. */
export interface ParsedEvent {
  title: string;
  date: DayKey;
  /** Minutes from midnight, or null for an all-day item. */
  startMinutes: number | null;
  durationMinutes: number;
  location: string;
  notes: string;
}

export type ScheduleParse =
  | { ok: true; events: ParsedEvent[]; dropped: number }
  | { ok: false; error: string };

/** Longest email accepted. Beyond this the tail is almost always footer. */
const MAX_INPUT = 24_000;

const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 60_000;

function instruction(today: DayKey, weekday: string, zone: string): string {
  return [
    'You read a school schedule email and return the timetable it describes as JSON.',
    `Today is ${weekday} ${today} in the ${zone} timezone.`,
    '',
    'Return ONLY a JSON array, no prose and no code fence. Each element:',
    '{"title": string, "date": "YYYY-MM-DD", "startMinutes": number|null, "durationMinutes": number, "location": string, "notes": string}',
    '',
    'Rules:',
    '- title is the class or event as a person would name it, e.g. "AP Calculus" or "Assembly". Do not include the time or room in the title.',
    '- date must be an actual calendar date. The email describes ONE upcoming week: resolve every weekday it names to the date in that week. If it does not say which week, use the week starting after today.',
    '- startMinutes is minutes from midnight (540 = 9:00 AM). Use null ONLY for something with no time at all.',
    '- durationMinutes is how long it runs. If only a start is given, use 60.',
    '- location is the room or place, or "" if none is given.',
    '- notes is anything a person would want to remember, such as "bring lab goggles", or "".',
    '- Include classes, assemblies, tests, trips and deadlines. Skip anything that is not a scheduled event: greetings, reminders about behaviour, newsletter chatter, signatures, links.',
    '- If the email contains no schedule at all, return [].',
    '- Never invent a class that is not in the email. A missing entry is recoverable; an invented one is not.',
  ].join('\n');
}

/** Read JSON out of an answer that may still have arrived wrapped in prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Models are told not to fence, and mostly do not. When one does, the
    // array is still in there and throwing away a correct answer over its
    // packaging would be its own bug.
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Is this a real calendar date, not just four digits and two dashes? */
function isRealDate(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d, 12);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Keep only entries that are entirely well-formed.
 *
 * Exported because it, not the model, is what makes this safe to run on an
 * email: it is the thing worth testing.
 *
 * Deliberately strict, and deliberately silent about what it rejected beyond
 * a count. A half-understood class — right name, invented time — is worse
 * than a missing one, because a missing one is visibly missing.
 */
export function validateEvents(raw: unknown): { events: ParsedEvent[]; dropped: number } {
  if (!Array.isArray(raw)) return { events: [], dropped: 0 };
  const events: ParsedEvent[] = [];
  let dropped = 0;
  for (const row of raw.slice(0, 200)) {
    if (!row || typeof row !== 'object') {
      dropped++;
      continue;
    }
    const r = row as Record<string, unknown>;
    const title = str(r.title, 80);
    const date = str(r.date, 10);
    if (!title || !isRealDate(date)) {
      dropped++;
      continue;
    }
    const rawStart = r.startMinutes;
    const timed = typeof rawStart === 'number' && Number.isFinite(rawStart);
    if (rawStart != null && !timed) {
      dropped++;
      continue;
    }
    const startMinutes = timed ? Math.round(rawStart as number) : null;
    if (startMinutes != null && (startMinutes < 0 || startMinutes > 1439)) {
      dropped++;
      continue;
    }
    const rawDuration = typeof r.durationMinutes === 'number' ? r.durationMinutes : 60;
    const durationMinutes = Math.min(1440, Math.max(5, Math.round(rawDuration) || 60));
    events.push({
      title,
      date,
      startMinutes,
      durationMinutes,
      location: str(r.location, 120),
      notes: str(r.notes, 400),
    });
  }
  // Same class listed twice in one email is the email's problem, not a
  // reason to put it on the day twice.
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.date}|${e.startMinutes ?? 'all'}|${e.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    events: unique.sort((a, b) =>
      a.date === b.date
        ? (a.startMinutes ?? -1) - (b.startMinutes ?? -1)
        : a.date < b.date
          ? -1
          : 1
    ),
    dropped,
  };
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function askClaude(key: string, system: string, email: string): Promise<string> {
  const res = await withTimeout(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: email }],
    }),
  });
  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `Claude error (${res.status}).`);
  return (body.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
}

async function askGemini(key: string, system: string, email: string): Promise<string> {
  const res = await withTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: email }] }],
        // Asking for JSON rather than hoping for it. The validator still
        // runs: a well-formed document can describe a nonsense timetable.
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    }
  );
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `Gemini error (${res.status}).`);
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

/**
 * Read a schedule email into events. Nothing is created here.
 *
 * `brain` is only passed by tests and the background job; normally it is
 * whichever model the user has already connected for the secretary.
 */
export async function parseScheduleEmail(
  email: string,
  brain?: BrainChoice | null
): Promise<ScheduleParse> {
  const text = email.trim();
  if (!text) return { ok: false, error: 'There was nothing in that email to read.' };

  const chosen = brain ?? (await loadBrain());
  if (!chosen) {
    return {
      ok: false,
      error: 'Connect Claude or Gemini in Settings first — reading the email needs one of them.',
    };
  }

  const today = todayKey();
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const system = instruction(today, weekday, zone);
  const input = text.slice(0, MAX_INPUT);

  let answer: string;
  try {
    answer =
      chosen.id === 'claude'
        ? await askClaude(chosen.apiKey, system, input)
        : await askGemini(chosen.apiKey, system, input);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'Reading the email timed out. Try again, or paste just the timetable part.'
        : e instanceof Error
          ? e.message
          : 'Could not reach the model.',
    };
  }

  const raw = extractJson(answer);
  if (raw == null) {
    return { ok: false, error: 'That answer was not a schedule. Try again, or paste less of the email.' };
  }
  const { events, dropped } = validateEvents(raw);
  if (events.length === 0) {
    return {
      ok: false,
      error:
        dropped > 0
          ? 'Nothing in that email survived checking. Paste just the timetable and try again.'
          : 'No classes found in that email.',
    };
  }
  return { ok: true, events, dropped };
}
