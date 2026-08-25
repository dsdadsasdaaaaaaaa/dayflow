import { askSecretary as askClaude } from './claude';
import { loadClaudeCredentials } from './claudeCredentials';
import { askSecretary as askGemini } from './gemini';
import { loadGeminiCredentials } from './geminiCredentials';
import type { ChatTurn, SecretaryOutcome, ToolRunner, ToolSpec } from './secretaryPrompt';

/**
 * Which model actually answers.
 *
 * Claude Sonnet is the intended brain; Gemini stays as the fallback so the
 * secretary keeps working for anyone who has only ever saved a Google key,
 * and so switching is just adding a key rather than a broken feature in
 * between. Same rule as the messaging route: the credential IS the switch.
 */

export type BrainId = 'claude' | 'gemini';

export interface BrainChoice {
  id: BrainId;
  apiKey: string;
}

/** Claude when a key is saved, else Gemini, else nothing configured. */
export async function loadBrain(): Promise<BrainChoice | null> {
  const claude = await loadClaudeCredentials();
  if (claude) return { id: 'claude', apiKey: claude.apiKey };
  const gemini = await loadGeminiCredentials();
  if (gemini) return { id: 'gemini', apiKey: gemini.apiKey };
  return null;
}

/** Human label for the settings screen. */
export function brainLabel(id: BrainId): string {
  return id === 'claude' ? 'Claude Sonnet' : 'Gemini';
}

export async function ask(
  brain: BrainChoice,
  history: ChatTurn[],
  tools: ToolSpec[],
  onToolCall: ToolRunner
): Promise<SecretaryOutcome> {
  return brain.id === 'claude'
    ? askClaude(brain.apiKey, history, tools, onToolCall)
    : askGemini(brain.apiKey, history, tools, onToolCall);
}
