import {
  systemInstructionNow,
  type ChatTurn,
  type SecretaryOutcome,
  type ToolRunner,
  type ToolSpec,
} from './secretaryPrompt';

/**
 * Anthropic Messages API client with tool use — the secretary's brain.
 *
 * No SDK and no server of ours: the user's own key goes straight to
 * api.anthropic.com. Everything sent is ALREADY redacted (see
 * secretaryPrivacy); this file must never be handed a real client name,
 * number or message body.
 *
 * The loop is: ask -> the model requests a tool -> we run it on device
 * against the live stores -> feed the pseudonymized result back -> repeat
 * until it answers in words, capped at MAX_ROUNDS.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Models to try, best first. A list rather than a constant for the reason the
 * Gemini client learned the hard way: a single pinned model id is a scheduled
 * outage the day the vendor retires it. Haiku is the safety net — a weaker
 * answer beats a dead feature.
 */
export const CLAUDE_MODELS = ['claude-sonnet-5', 'claude-haiku-4-5-20251001'] as const;

export const CLAUDE_MODEL = CLAUDE_MODELS[0];

const MAX_ROUNDS = 5;
const TIMEOUT_MS = 45_000;
const MAX_TOKENS = 900;

/** A tool call the model asked for, in Anthropic's shape. */
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

interface TextBlock {
  type: 'text';
  text: string;
}

type ContentBlock = ToolUseBlock | TextBlock | { type: string; [k: string]: unknown };

interface ClaudeResponse {
  content?: ContentBlock[];
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

function isToolUse(b: ContentBlock): b is ToolUseBlock {
  return b.type === 'tool_use';
}

function isText(b: ContentBlock): b is TextBlock {
  return b.type === 'text';
}

/** A sentence the UI can show as-is. */
function explainHttpFailure(status: number, body: string): string {
  let message = '';
  try {
    const parsed = JSON.parse(body) as ClaudeResponse;
    message = parsed.error?.message?.trim() ?? '';
  } catch {
    message = '';
  }
  if (status === 401 || status === 403) {
    return 'Anthropic rejected the API key. Check the key saved in Settings.';
  }
  if (status === 404) {
    return `Anthropic does not recognize any model this app knows about (${CLAUDE_MODELS.join(', ')}). The list in src/lib/claude.ts needs updating.`;
  }
  if (status === 429) {
    return 'Anthropic is rate limiting this key right now. Give it a minute and try again.';
  }
  if (status === 400) {
    return message
      ? `Anthropic rejected the request: ${message.slice(0, 200)}`
      : 'Anthropic rejected the request.';
  }
  if (status >= 500) {
    return 'Anthropic is having trouble right now. Try again in a moment.';
  }
  return message ? message.slice(0, 200) : `Anthropic returned an error (${status}).`;
}

/** True when the failure means "this model id is not available to this key". */
function isUnknownModel(status: number, body: string): boolean {
  return (status === 404 || status === 400) && /model/i.test(body);
}

let resolvedModel: string | null = null;

function modelsToTry(): string[] {
  const rest = CLAUDE_MODELS.filter((m) => m !== resolvedModel);
  return resolvedModel ? [resolvedModel, ...rest] : [...rest];
}

/** One Messages call. Resolves to the parsed body or a typed failure. */
async function postTurn(
  apiKey: string,
  messages: ClaudeMessage[],
  tools: ToolSpec[]
): Promise<{ ok: true; data: ClaudeResponse } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    max_tokens: MAX_TOKENS,
    temperature: 0.4,
    system: systemInstructionNow(),
    messages,
  };
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      // Anthropic requires an object schema even for no-argument tools.
      input_schema: t.parameters ?? { type: 'object', properties: {} },
    }));
  }

  let lastError = 'Anthropic did not answer.';
  for (const model of modelsToTry()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          // Needed only for the web preview, where the request is subject to
          // CORS. Harmless on device, where fetch is not browser-sandboxed.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ ...body, model }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = explainHttpFailure(res.status, text);
        // A retired model is the only failure worth retrying: try the next id.
        // A bad key, rate limit or outage fails the same on every model.
        if (isUnknownModel(res.status, text)) continue;
        return { ok: false, error: lastError };
      }
      try {
        const data = JSON.parse(text) as ClaudeResponse;
        resolvedModel = model;
        return { ok: true, data };
      } catch {
        return { ok: false, error: 'Anthropic sent a reply the app could not read.' };
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      return {
        ok: false,
        error: aborted
          ? 'Claude took too long to answer. Try again.'
          : 'Could not reach Anthropic. Check your connection.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Run one question through Claude, executing any tools it asks for locally,
 * and return the final text. Never throws — failures come back as
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
    return { ok: false, error: 'No Anthropic API key saved. Add one in Settings.' };
  }

  const messages: ClaudeMessage[] = history.map((t) => ({
    role: t.role === 'model' ? 'assistant' : 'user',
    content: t.text,
  }));

  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await postTurn(apiKey, messages, tools);
    if (!res.ok) return { ok: false, error: res.error };

    const blocks = res.data.content ?? [];
    const calls = blocks.filter(isToolUse);

    if (calls.length === 0 || res.data.stop_reason !== 'tool_use') {
      const text = blocks
        .filter(isText)
        .map((b) => b.text)
        .join('')
        .trim();
      if (!text) {
        return { ok: false, error: 'Claude answered with nothing. Try rephrasing.' };
      }
      return { ok: true, text, toolsUsed };
    }

    // Anthropic requires the assistant turn to be echoed back verbatim before
    // the results, so the tool_use ids it refers to still resolve.
    messages.push({ role: 'assistant', content: blocks });

    const results = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      let output: unknown;
      try {
        output = await onToolCall(call.name, call.input ?? {});
      } catch (e) {
        output = { error: e instanceof Error ? e.message : 'tool failed' };
      }
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(output ?? null),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    ok: false,
    error: 'Claude kept looking things up without answering. Try a narrower question.',
  };
}
