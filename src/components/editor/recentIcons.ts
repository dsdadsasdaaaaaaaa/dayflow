import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'dayflow-recent-icons';
const MAX = 12;

/** Load the recently used icon names (most recent first). */
export async function loadRecentIcons(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is string => typeof x === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

/** Record an icon as most-recently used (deduped, capped at 12). */
export async function pushRecentIcon(icon: string): Promise<void> {
  try {
    const list = await loadRecentIcons();
    const next = [icon, ...list.filter((i) => i !== icon)].slice(0, MAX);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}
