import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * textbee gateway credentials, in the device keychain like every other
 * messaging secret. Mirrors telerivetCredentials.
 */

export interface TextbeeCredentials {
  /**
   * API root, without a trailing slash. Configurable because the whole point
   * of this route is that it can be self-hosted — the free tier is
   * api.textbee.dev, but a private server is the version with no metering
   * and no third party holding the messages.
   */
  baseUrl: string;
  apiKey: string;
  /** The registered Android device that holds the SIM. */
  deviceId: string;
  /** The SIM's own number in E.164, for telling our messages from theirs. */
  fromNumber: string;
}

const KEY = 'dayflow-textbee-credentials';
const DEFAULT_BASE = 'https://api.textbee.dev/api/v1';
let memoryFallback: TextbeeCredentials | null = null;

export function defaultTextbeeBase(): string {
  return DEFAULT_BASE;
}

export async function loadTextbeeCredentials(): Promise<TextbeeCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TextbeeCredentials>;
    if (!parsed.apiKey || !parsed.deviceId || !parsed.fromNumber) return null;
    return { baseUrl: parsed.baseUrl || DEFAULT_BASE, ...parsed } as TextbeeCredentials;
  } catch {
    return null;
  }
}

export async function saveTextbeeCredentials(creds: TextbeeCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearTextbeeCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}
