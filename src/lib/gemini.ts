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

// Type-only: no runtime edge back to secretaryTools (which imports the tool
// types from here), so the two files never form an import cycle at runtime.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SecretaryAction } from './secretaryTools';
import {
  systemInstructionNow,
  type ChatTurn,
  type SecretaryOutcome,
  type ToolParameterSchema,
  type ToolRunner,
  type ToolSpec,
} from './secretaryPrompt';

export type {
  ChatTurn,
  SecretaryOutcome,
  ToolParameterSchema,
  ToolRunner,
  ToolSpec,
} from './secretaryPrompt';

/**
 * The model id. Google renames these often and retires the old names; this
 * is the ONE place to change it. A rejected name surfaces as a plain-English
 * error telling the user exactly that.
 */
/**
 * Models to try, best first.
 *
 * This is a list rather than a constant because of exactly how this feature
 * broke: it was pinned to "gemini-flash-latest", which quietly resolved to
 * gemini-2.0-flash, which Google shut down on 2026-06-01. The alias started
 * 404ing and the secretary was dead from then until someone noticed. Google
 * ships and retires Flash models every few weeks, so any single hardcoded id
 * is a scheduled outage.
 *
 * On a "no such model" failure the client walks down this list and remembers
 * whichever one answers, so a retirement costs one wasted request rather than
 * the whole feature. Newest first; the older entries are the safety net.
 */
export const GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
] as const;

/** Preferred model — what a fresh install tries first. */
export const GEMINI_MODEL = GEMINI_MODELS[0];

/** Whichever model last answered, so we do not re-pay the 404 every call. */
let resolvedModel: string | null = null;
/** Set once every known name has been refused, so discovery runs only once. */
let exhausted = false;

const MODEL_CACHE_KEY = 'dayflow-gemini-model';

/** Restore the last known-good model; safe to call more than once. */
async function loadResolvedModel(): Promise<void> {
  if (resolvedModel) return;
  try {
    const saved = await AsyncStorage.getItem(MODEL_CACHE_KEY);
    // Any saved id is trusted, not just ones from GEMINI_MODELS: discovery
    // can settle on a model this list has never heard of, and rejecting it
    // here would mean rediscovering on every launch.
    if (saved) resolvedModel = saved;
  } catch {
    // Cache unavailable — we just re-discover on first call.
  }
}

/**
 * Which model actually answered, once one has. Null before the first request
 * of a session, since the id is settled by trying rather than by config.
 */
export async function resolvedGeminiModel(): Promise<string | null> {
  await loadResolvedModel();
  return resolvedModel;
}

async function rememberModel(model: string): Promise<void> {
  resolvedModel = model;
  try {
    await AsyncStorage.setItem(MODEL_CACHE_KEY, model);
  } catch {
    // Not caching only costs a re-discovery next launch.
  }
}

/** The order to try this call: last known-good first, then the rest. */
function modelsToTry(): string[] {
  const rest = GEMINI_MODELS.filter((m) => m !== resolvedModel);
  return resolvedModel ? [resolvedModel, ...rest] : [...rest];
}

/**
 * True when a failure means "this model id is not available to this key".
 *
 * 5xx is included deliberately. A model id this API version cannot serve does
 * not always come back as a clean 404 — an unknown or wrong-version name can
 * surface as a server error, which then read to the user as "Gemini is having
 * trouble" forever instead of moving on to a name that works.
 */
function isUnknownModel(status: number, body: string): boolean {
  if (status >= 500) return true;
  return (status === 404 || status === 400) && /model/i.test(body);
}

/**
 * Ask the API which models this key can actually use.
 *
 * Hardcoded lists are how this broke the first time: an id is guessed from
 * documentation, Google renames or retires it, and the feature dies silently.
 * The endpoint knows the answer, so when every known name fails we ask rather
 * than guess again, and prefer the newest flash-class model offered.
 */
async function discoverModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}&pageSize=100`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      models?: { name?: string; supportedGenerationMethods?: string[] }[];
    };
    const usable = (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean)
      // Skip previews and specialist variants; we want the plain chat models.
      .filter((n) => !/embedding|aqa|vision|image|tts|live|preview/i.test(n));
    // Flash first (cheap, fast, tool-capable), newest-looking first.
    const flash = usable.filter((n) => /flash/i.test(n)).sort().reverse();
    const rest = usable.filter((n) => !/flash/i.test(n)).sort().reverse();
    return [...flash, ...rest];
  } catch {
    return [];
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Tool round trips per question before we stop and answer with what we have. */
/**
 * Tool rounds before the model is made to answer.
 *
 * Raised from five because the assistant is now told to read a client's
 * actual thread before making claims about them, and a question about four
 * or five people spends a round each. Running out used to surface as "ask a
 * narrower question", which blamed the user for a budget they could not see.
 */
const MAX_ROUNDS = 10;
/** Per-request network timeout. */
/** Per request. Generous because every request now carries an inbox digest. */
const TIMEOUT_MS = 90_000;

/** One turn of the conversation. `text` is redacted on the wire, real on device. */

/** OpenAPI-subset schema for a tool's arguments (Gemini's accepted shape). */






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
    // Only surfaced once every model in GEMINI_MODELS has been refused.
    return `Gemini does not recognize any of the models this app knows about (${GEMINI_MODELS.join(', ')}). Google retires Flash models regularly — the list in src/lib/gemini.ts needs a newer one.`;
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
/** One request against one model id. Never throws. */
async function attempt(
  apiKey: string,
  body: Record<string, unknown>,
  model: string
): Promise<
  | { ok: true; data: GeminiResponse }
  | { ok: false; error: string; unknownModel: boolean }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: explainHttpFailure(res.status, text),
        unknownModel: isUnknownModel(res.status, text),
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as GeminiResponse };
    } catch {
      return {
        ok: false,
        error: 'Gemini sent a reply the app could not read.',
        unknownModel: false,
      };
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'Gemini took too long to answer. Try again.'
        : 'Could not reach Gemini. Check your connection.',
      unknownModel: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

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

  await loadResolvedModel();
  let candidates = modelsToTry();
  // If every name we know has already been refused this session, ask the API
  // what it actually has before giving up.
  if (exhausted) {
    const found = await discoverModels(apiKey);
    if (found.length > 0) candidates = found;
  }
  // Keep the LAST model failure so that if every candidate is refused the
  // user sees a model-shaped error rather than whatever the final one said.
  let lastError = 'Gemini did not answer.';

  for (const model of candidates) {
    const res = await attempt(apiKey, body, model);
    if (res.ok) {
      if (model !== resolvedModel) await rememberModel(model);
      return res;
    }
    lastError = res.error;
    // A retired or unavailable model is the one failure worth retrying: try
    // the next id. Anything else (bad key, rate limit, network) would fail
    // identically on every model, so stop and report it.
    if (!res.unknownModel) return { ok: false, error: lastError };
  }
  // Everything we knew about was refused. Ask the API for a real list and try
  // once more before reporting failure, so a rename costs one retry, not the
  // feature.
  if (!exhausted) {
    exhausted = true;
    const found = await discoverModels(apiKey);
    const fresh = found.filter((m) => !candidates.includes(m));
    for (const model of fresh) {
      const res = await attempt(apiKey, body, model);
      if (res.ok) {
        await rememberModel(model);
        return res;
      }
      lastError = res.error;
      if (!res.unknownModel) return { ok: false, error: lastError };
    }
  }
  return { ok: false, error: lastError };
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
    // Withhold the tools on the final round. The model cannot then ask for
    // anything else and has to answer from what it has, which is far more
    // use than an error telling the user their question was too broad.
    const lastRound = round === MAX_ROUNDS - 1;
    const res = await postTurn(apiKey, contents, lastRound ? [] : tools);
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
