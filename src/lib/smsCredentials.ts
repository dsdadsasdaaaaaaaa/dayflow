import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Messaging credentials live in the device keychain (SecureStore), never in
 * the regular app storage or backups. Web preview falls back to memory only.
 */

export interface SmsCredentials {
  /** Twilio Account SID (starts with "AC"). */
  accountSid: string;
  /** Twilio Auth Token. */
  authToken: string;
  /** The sending number in E.164, e.g. "+15551234567". */
  fromNumber: string;
}

const KEY = 'dayflow-sms-credentials';
let memoryFallback: SmsCredentials | null = null;

export async function loadSmsCredentials(): Promise<SmsCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SmsCredentials>;
    if (!parsed.accountSid || !parsed.authToken || !parsed.fromNumber) return null;
    return parsed as SmsCredentials;
  } catch {
    return null;
  }
}

export async function saveSmsCredentials(creds: SmsCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearSmsCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}

/** Loose E.164 normalization: keeps digits, ensures a leading +. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return '+' + digits.slice(1).replace(/\D/g, '');
  const bare = digits.replace(/\D/g, '');
  // Default to US when 10 digits without a country code.
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  return bare ? `+${bare}` : '';
}
