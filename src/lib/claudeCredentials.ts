import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The user's own Anthropic API key, in the device keychain (SecureStore) —
 * never in regular app storage or backups. Mirrors geminiCredentials.
 */

export interface ClaudeCredentials {
  /** Anthropic API key (starts with "sk-ant-"). */
  apiKey: string;
}

const KEY = 'dayflow-claude';
let memoryFallback: ClaudeCredentials | null = null;

export async function loadClaudeCredentials(): Promise<ClaudeCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClaudeCredentials>;
    if (!parsed.apiKey) return null;
    return parsed as ClaudeCredentials;
  } catch {
    return null;
  }
}

export async function saveClaudeCredentials(creds: ClaudeCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearClaudeCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}
