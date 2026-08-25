/**
 * Minimal Gemini REST client with function calling — the brain behind the
 * secretary. No SDK, no server of ours: the user's own API key, straight to
 * generativelanguage.googleapis.com.
 *
 * Everything sent here is ALREADY redacted (see src/lib/secretaryPrivacy.ts).
 * This file must never be handed a real client name, number or message body.
 *
 * The loop is: ask → the model requests a local function → we run it on
 * device against the live stores → feed the (pseudonymized) result back →
 * repeat until it answers in words, capped at MAX_ROUNDS.
 */

/**
 * The model id. Google renames these often and retires the old names; this
 * is the ONE place to change it. A rejected name surfaces as a plain-English
 * error telling the user exactly that.
 */
export const GEMINI_MODEL = 'gemini-flash-latest';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Tool round trips per question before we stop and answer with what we have. */
const MAX_ROUNDS = 5;
/** Per-request network timeout. */
const TIMEOUT_MS = 45_000;

/** One turn of the conversation. `text` is redacted on the wire, real on device. */
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
}

/** OpenAPI-subset schema for a tool's arguments (Gemini's accepted shape). */
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

const SYSTEM_INSTRUCTION = [
  'You are the scheduling assistant for a sole proprietor who runs paid client meetings booked over text.',
  'Clients are referred to ONLY by pseudonymous labels ("Client 1", "Client 2"). You never see real names, numbers or message contents, and you must never ask for them or guess at them.',
  'Be concise and practical: short answers, plain sentences, no preamble, no bullet lists unless the user asks for a list.',
  'Never invent clients, meetings, bookings, amounts or history. If a tool returns nothing, say so plainly.',
  'Use the tools for every factual claim about the schedule, money or clients — do not answer those from memory.',
  'When you suggest contacting someone, ALWAYS say why: their usual rhythm is overdue, they have an unanswered message, they owe an outstanding balance, or a gap is about to go unfilled.',
  'Times from tools are minutes from midnight (540 = 9:00 AM); dates are "YYYY-MM-DD". Convert them to friendly times and day names in your answer.',
  'Money is in the user\'s own currency; report amounts exactly as the tools give them.',
].join(' ');

/**
 * The model has no clock. A scheduling assistant that does not know today's
 * date cannot resolve "tomorrow evening" or pass a sensible date to
 * get_schedule, so the current moment is stamped into the system instruction
 * on every request (in the user's own timezone, not UTC).
 */
function systemInstructionNow(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const minutes = now.getHours() * 60 + now.getMinutes();
  return [
    SYSTEM_INSTRUCTION,
    `Right now it is ${weekday}, ${y}-${m}-${d}, ${minutes} minutes past midnight local time.`,
    'Resolve "today", "tomorrow", "this evening" and weekday names against that, and pass real YYYY-MM-DD dates to tools.',
  ].join(' ');
}

interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/** Human-readable failure for a non-2xx response. */
function explainHttpFailure(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as GeminiResponse;
    message = parsed.error?.message?.trim() ?? '';
  } catch {
    message = '';
  }
  const mentionsModel = /model/i.test(message) || /model/i.test(body);

  if ((status === 404 || status === 400) && mentionsModel) {
    return `Gemini does not recognize the model "${GEMINI_MODEL}". Google renames models regularly — the model name needs updating in the app (GEMINI_MODEL in src/lib/gemini.ts).`;
  }
  if (status === 400) {
    return message
      ? `Gemini rejected the request: ${message.slice(0, 200)}`
      : 'Gemini rejected the request.';
  }
  if (status === 401 || status === 403) {
    return 'Gemini rejected the API key. Check the key saved in Settings.';
  }
  if (status === 429) {
    return 'Gemini is rate limiting this key right now. Give it a minute and try again.';
  }
  if (status >= 500) {
    return 'Gemini is having trouble right now. Try again in a moment.';
  }
  return message ? message.slice(0, 200) : `Gemini returned an error (${status}).`;
}

/** One generateContent call. Resolves to the parsed body or a typed failure. */
async function postTurn(
  apiKey: string,
  contents: GeminiContent[],
  tools: ToolSpec[]
): Promise<{ ok: true; data: GeminiResponse } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemInstructionNow() }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
  };
  if (tools.length > 0) {
    body.tools = [
      {
        function_declarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          ...(t.parameters ? { parameters: t.parameters } : {}),
        })),
      },
    ];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${ENDPOINT}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    const text = await res.text();
    if (!res.ok) return { ok: false, error: explainHttpFailure(res.status, text) };
    try {
      return { ok: true, data: JSON.parse(text) as GeminiResponse };
    } catch {
      return { ok: false, error: 'Gemini sent a reply the app could not read.' };
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'Gemini took too long to answer. Try again.'
        : 'Could not reach Gemini. Check your connection.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one question through the model, executing any tools it asks for
 * locally, and return the final text. Never throws — failures come back as
 * `{ ok: false, error }` with a sentence the UI can show as-is.
 *
 * `history` must already be redacted (last turn = the current question).
 */
export async function askSecretary(
  apiKey: string,
  history: ChatTurn[],
  tools: ToolSpec[],
  onToolCall: ToolRunner
): Promise<SecretaryOutcome> {
  if (!apiKey.trim()) {
    return { ok: false, error: 'No Gemini API key saved. Add one in Settings.' };
  }
  if (history.length === 0) {
    return { ok: false, error: 'Nothing to ask.' };
  }

  const contents: GeminiContent[] = history.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await postTurn(apiKey, contents, tools);
    if (!res.ok) return { ok: false, error: res.error };

    const candidate = res.data.candidates?.[0];
    const blocked = res.data.promptFeedback?.blockReason;
    if (blocked) {
      return { ok: false, error: 'Gemini declined to answer that one.' };
    }
    const parts = candidate?.content?.parts ?? [];
    const calls = parts
      .map((p) => p.functionCall)
      .filter((c): c is GeminiFunctionCall => !!c && !!c.name);

    if (calls.length === 0) {
      const text = parts
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text) {
        return {
          ok: false,
          error:
            candidate?.finishReason === 'SAFETY'
              ? 'Gemini declined to answer that one.'
              : 'Gemini sent an empty reply. Try rephrasing.',
        };
      }
      return { ok: true, text, toolsUsed };
    }

    // Echo the model's own turn back verbatim — the API requires the
    // functionCall parts to precede their functionResponse parts.
    contents.push({ role: 'model', parts });

    const responses: GeminiPart[] = [];
    for (const call of calls) {
      const name = call.name as string;
      toolsUsed.push(name);
      let result: unknown;
      try {
        result = await onToolCall(name, call.args ?? {});
      } catch {
        result = { error: `The ${name} lookup failed on this device.` };
      }
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return {
    ok: false,
    error: 'The assistant kept looking things up without answering. Try a narrower question.',
  };
}
