import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface DayflowLiveActivityNativeModule {
  isSupported(): boolean;
  startActivity(
    clientName: string,
    kindLabel: string,
    rateLabel: string,
    symbolName: string,
    startedAtMs: number,
    endAtMs: number
  ): Promise<void>;
  updateActivity(endAtMs: number, overtime: boolean): Promise<void>;
  endActivity(): Promise<void>;
  /** Missing on binaries built before it existed — call via optional check. */
  setExcludedFromBackup?(path: string): Promise<boolean>;
}

/** Null in Expo Go, on web, and on Android — every wrapper below no-ops then. */
const native =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<DayflowLiveActivityNativeModule>('DayflowLiveActivity')
    : null;

/** False on web/Expo Go/Android or iOS < 16.2 (or Live Activities disabled). */
export function isLiveActivitySupported(): boolean {
  if (!native) return false;
  try {
    return native.isSupported();
  } catch {
    return false;
  }
}

export async function startMeetingActivity(input: {
  clientName: string;
  kindLabel: string;
  rateLabel: string;
  symbolName: string;
  startedAtMs: number;
  endAtMs: number;
}): Promise<void> {
  if (!native) return;
  try {
    await native.startActivity(
      input.clientName,
      input.kindLabel,
      input.rateLabel,
      input.symbolName,
      input.startedAtMs,
      input.endAtMs
    );
  } catch {
    // Live Activity failures must never break the in-app session flow.
  }
}

export async function updateMeetingActivity(input: {
  endAtMs: number;
  overtime: boolean;
}): Promise<void> {
  if (!native) return;
  try {
    await native.updateActivity(input.endAtMs, input.overtime);
  } catch {
    // no-op
  }
}

export async function endMeetingActivity(): Promise<void> {
  if (!native) return;
  try {
    await native.endActivity();
  } catch {
    // no-op
  }
}

/**
 * Flag a file/directory with NSURLIsExcludedFromBackupKey so it never rides
 * iCloud/iTunes device backups (e.g. TDLib's Documents/tdlib database).
 * `path` is an absolute filesystem path (no file:// scheme). Returns false —
 * never throws — on web/Expo Go/Android, on binaries built before this
 * function existed, or when the path does not exist yet.
 */
export async function setExcludedFromBackupAsync(path: string): Promise<boolean> {
  if (!native || typeof native.setExcludedFromBackup !== 'function') return false;
  try {
    return (await native.setExcludedFromBackup(path)) === true;
  } catch {
    return false;
  }
}
