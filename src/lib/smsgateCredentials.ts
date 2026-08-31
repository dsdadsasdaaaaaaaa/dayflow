import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * SMSGate + inbox-relay credentials, in the device keychain like every other
 * messaging secret.
 *
 * Two halves, because the free setup is two pieces: SMSGate's cloud sends
 * from the SIM, and a small Cloudflare Worker holds received messages so
 * this app has something to poll. See worker/README.md.
 */

export interface SmsGateCredentials {
  /** SMSGate cloud API root. */
  baseUrl: string;
  /** Username and password from the SMSGate app's Home tab (Basic auth). */
  username: string;
  password: string;
  /** The deployed Worker's origin, e.g. https://dayflow-inbox.<you>.workers.dev */
  inboxUrl: string;
  /** Shared secret configured on the Worker. */
  inboxSecret: string;
  /** The SIM's own number in E.164. */
  fromNumber: string;
}

const KEY = 'dayflow-smsgate-credentials';
const DEFAULT_BASE = 'https://api.sms-gate.app/3rdparty/v1';
let memoryFallback: SmsGateCredentials | null = null;

export function defaultSmsGateBase(): string {
  return DEFAULT_BASE;
}

export async function loadSmsGateCredentials(): Promise<SmsGateCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SmsGateCredentials>;
    if (!p.username || !p.password || !p.fromNumber) return null;
    return { baseUrl: p.baseUrl || DEFAULT_BASE, ...p } as SmsGateCredentials;
  } catch {
    return null;
  }
}

export async function saveSmsGateCredentials(creds: SmsGateCredentials): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearSmsGateCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}
