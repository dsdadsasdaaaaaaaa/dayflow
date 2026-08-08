import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Telegram API credentials (from my.telegram.org) live in the device keychain
 * (SecureStore), never in regular app storage or backups. Web preview falls
 * back to memory only. Mirrors src/lib/smsCredentials.ts.
 */

export interface TelegramCredentials {
  /** Numeric api_id issued at my.telegram.org. */
  apiId: number;
  /** api_hash issued at my.telegram.org. */
  apiHash: string;
}

const KEY = 'dayflow-telegram-api';
let memoryFallback: TelegramCredentials | null = null;

export async function loadTelegramCredentials(): Promise<TelegramCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TelegramCredentials>;
    if (typeof parsed.apiId !== 'number' || !Number.isFinite(parsed.apiId)) return null;
    if (typeof parsed.apiHash !== 'string' || !parsed.apiHash) return null;
    return { apiId: parsed.apiId, apiHash: parsed.apiHash };
  } catch {
    return null;
  }
}

export async function saveTelegramCredentials(creds: TelegramCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearTelegramCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}
