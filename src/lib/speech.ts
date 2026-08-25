import { Platform } from 'react-native';

/**
 * Dictation for the AI secretary. The ONLY file that touches
 * expo-speech-recognition.
 *
 * OTA SAFETY: the native module is absent from binaries built before it was
 * added, and its JS entry throws at require time when unlinked — so every
 * access goes through a lazy, cached, try/catch'd require. On web or an old
 * binary each export degrades quietly and the UI offers the keyboard's own
 * mic key instead.
 *
 * PRIVACY: requiresOnDeviceRecognition is requested, which keeps audio on the
 * phone via Apple's local Speech framework. iOS silently falls back to server
 * recognition on devices/locales that lack on-device support, so this is a
 * strong preference rather than a guarantee — worth knowing given how
 * sensitive the surrounding data is.
 */

type SpeechModule = typeof import('expo-speech-recognition');

let cached: SpeechModule | null | undefined;

function speechModule(): SpeechModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') {
    cached = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('expo-speech-recognition') as SpeechModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** Is dictation available in this binary? Cached probe, safe everywhere. */
export function speechAvailable(): boolean {
  const mod = speechModule();
  return mod?.ExpoSpeechRecognitionModule != null;
}

export interface DictationHandlers {
  /** Live text as the user speaks (may be revised on the next callback). */
  onPartial?: (text: string) => void;
  /** The settled transcript once recognition ends. */
  onFinal: (text: string) => void;
  /** Human-readable failure; recognition has already stopped. */
  onError?: (message: string) => void;
}

export type StopDictation = () => void;

/**
 * Start listening. Resolves with a stop function once recognition is running;
 * resolves with null when dictation is unavailable or permission is refused.
 * Never throws.
 */
export async function startDictation(
  handlers: DictationHandlers
): Promise<StopDictation | null> {
  const mod = speechModule();
  if (!mod?.ExpoSpeechRecognitionModule) return null;
  const api = mod.ExpoSpeechRecognitionModule;

  try {
    const perm = await api.requestPermissionsAsync();
    if (!perm.granted) {
      handlers.onError?.('Allow microphone and speech access in Settings to dictate.');
      return null;
    }

    let settled = '';
    const subs: { remove: () => void }[] = [];

    subs.push(
      api.addListener('result', (event: { results?: { transcript?: string }[]; isFinal?: boolean }) => {
        const text = event.results?.[0]?.transcript ?? '';
        if (!text) return;
        settled = text;
        if (event.isFinal) handlers.onFinal(text);
        else handlers.onPartial?.(text);
      })
    );
    subs.push(
      api.addListener('error', (event: { error?: string }) => {
        // "no-speech" just means silence — not worth alarming the user.
        if (event.error !== 'no-speech') {
          handlers.onError?.('Could not hear that. Try again.');
        }
      })
    );
    subs.push(
      api.addListener('end', () => {
        // Commit whatever was heard if no final result ever arrived.
        if (settled) {
          handlers.onFinal(settled);
          settled = '';
        }
        for (const s of subs) {
          try {
            s.remove();
          } catch {
            // Already detached.
          }
        }
      })
    );

    api.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: true,
    } as Parameters<typeof api.start>[0]);

    return () => {
      try {
        api.stop();
      } catch {
        // Already stopped.
      }
    };
  } catch {
    handlers.onError?.('Dictation could not start.');
    return null;
  }
}
