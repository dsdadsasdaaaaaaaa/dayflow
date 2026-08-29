import { askSecretary as askClaude } from './claude';
import { loadClaudeCredentials } from './claudeCredentials';
import { askSecretary as askGemini } from './gemini';
import { loadGeminiCredentials } from './geminiCredentials';
import { useSettings } from '../store/settings';
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

/**
 * The model that answers: whichever the user picked, when a key for it is
 * saved, otherwise whatever is available. Keeping both keys and switching
 * between them beats deleting one to move, since the other has to be pasted
 * back in to return.
 */
export async function loadBrain(): Promise<BrainChoice | null> {
  const [claude, gemini] = await Promise.all([
    loadClaudeCredentials(),
    loadGeminiCredentials(),
  ]);
  const preferred = useSettings.getState().settings.secretaryBrain;
  if (preferred === 'gemini' && gemini) return { id: 'gemini', apiKey: gemini.apiKey };
  if (preferred === 'claude' && claude) return { id: 'claude', apiKey: claude.apiKey };
  if (claude) return { id: 'claude', apiKey: claude.apiKey };
  if (gemini) return { id: 'gemini', apiKey: gemini.apiKey };
  return null;
}

/** Which brains have a key saved, for offering a choice. */
export async function connectedBrains(): Promise<BrainId[]> {
  const [claude, gemini] = await Promise.all([
    loadClaudeCredentials(),
    loadGeminiCredentials(),
  ]);
  const out: BrainId[] = [];
  if (claude) out.push('claude');
  if (gemini) out.push('gemini');
  return out;
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
