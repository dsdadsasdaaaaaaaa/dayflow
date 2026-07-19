import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useSettings } from '../store/settings';

function enabled(): boolean {
  return Platform.OS !== 'web' && useSettings.getState().settings.haptics;
}

export function tapHaptic(): void {
  if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function successHaptic(): void {
  if (enabled())
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warningHaptic(): void {
  if (enabled())
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export function selectionHaptic(): void {
  if (enabled()) Haptics.selectionAsync().catch(() => {});
}
