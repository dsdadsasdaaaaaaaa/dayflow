import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The user's own Gemini API key lives in the device keychain (SecureStore),
 * never in regular app storage or backups. Web preview falls back to memory
 * only. Mirrors src/lib/smsCredentials.ts.
 */

export interface GeminiCredentials {
  /** Google AI Studio API key (starts with "AIza"). */
  apiKey: string;
}

const KEY = 'dayflow-gemini';
let memoryFallback: GeminiCredentials | null = null;

export async function loadGeminiCredentials(): Promise<GeminiCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeminiCredentials>;
    if (!parsed.apiKey) return null;
    return parsed as GeminiCredentials;
  } catch {
    return null;
  }
}

export async function saveGeminiCredentials(creds: GeminiCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearGeminiCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}
