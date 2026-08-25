import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Telerivet credentials, kept in the device keychain exactly like the Twilio
 * ones (see smsCredentials) — never in app storage or backups.
 *
 * Telerivet is the "own SIM" route: an Android phone with a normal consumer
 * SIM relays our messages over the carrier's ordinary person-to-person path,
 * instead of a carrier-registered A2P long code. See lib/telerivet for why
 * that distinction is the whole point.
 */

export interface TelerivetCredentials {
  /** Telerivet API key (Basic auth username). */
  apiKey: string;
  /** Project id the phone is attached to, e.g. "PJxxxxxxxx". */
  projectId: string;
  /**
   * Which phone/route sends, when the project has more than one. Blank lets
   * Telerivet pick the project default.
   */
  routeId?: string;
  /**
   * The SIM's own number in E.164. Telerivet does not reliably report the
   * sending number on outbound records, and the app needs it to tell "this
   * came from my current number" from "this came from one I rotated away
   * from", so the user states it when connecting.
   */
  fromNumber: string;
}

const KEY = 'dayflow-telerivet-credentials';
let memoryFallback: TelerivetCredentials | null = null;

export async function loadTelerivetCredentials(): Promise<TelerivetCredentials | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TelerivetCredentials>;
    if (!parsed.apiKey || !parsed.projectId || !parsed.fromNumber) return null;
    return parsed as TelerivetCredentials;
  } catch {
    return null;
  }
}

export async function saveTelerivetCredentials(
  creds: TelerivetCredentials
): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = creds;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(creds));
}

export async function clearTelerivetCredentials(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}
