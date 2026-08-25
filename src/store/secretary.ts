import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { askSecretary, type ChatTurn } from '../lib/gemini';
import { loadGeminiCredentials } from '../lib/geminiCredentials';
import {
  assertNoPii,
  buildPseudonyms,
  redactText,
  restoreText,
} from '../lib/secretaryPrivacy';
import {
  SECRETARY_TOOLS,
  buildToolRunner,
  collectClientNames,
} from '../lib/secretaryTools';
import { PERSIST_VERSION, migrateStore } from './persistVersion';

/**
 * The AI secretary's conversation.
 *
 * Two texts exist for every turn and they are never confused:
 * - the LOCAL one, with real client names, which is what gets persisted and
 *   shown on screen. It never leaves the device.
 * - the WIRE one, rebuilt from scratch on every request by running the local
 *   text through a fresh pseudonym map, which is all Gemini ever sees.
 *
 * The map is rebuilt per request from the current client list, so labels are
 * only meaningful inside one exchange. The whole (trimmed) history is
 * re-redacted with that same map each time, which keeps the conversation
 * self-consistent for the model without ever storing a wire transcript.
 */

/** Turns kept on device (a turn is one user or one model message). */
const MAX_TURNS = 40;
/** Turns sent as context — enough for follow-ups, small enough to stay cheap. */
const CONTEXT_TURNS = 20;

interface SecretaryState {
  /** Local transcript with REAL names, oldest first. */
  messages: ChatTurn[];
  /** A request is in flight. */
  busy: boolean;
  /** Last failure, ready to show as-is; cleared on the next ask. */
  lastError: string | null;
  /** User has switched the secretary on (the API key lives in the keychain). */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Ask a question. Appends the user turn immediately, the reply when it lands. */
  ask: (text: string) => Promise<void>;
  clear: () => void;
}

/** Keep the transcript bounded. */
function capTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.length > MAX_TURNS ? turns.slice(turns.length - MAX_TURNS) : turns;
}

export const useSecretary = create<SecretaryState>()(
  persist(
    (set, get) => ({
      messages: [],
      busy: false,
      lastError: null,
      enabled: false,

      setEnabled: (enabled) => set({ enabled }),

      ask: async (text) => {
        const question = text.trim();
        if (!question || get().busy) return;

        // The user's turn shows up straight away, in real names, locally.
        set((s) => ({
          messages: capTurns([
            ...s.messages,
            { role: 'user', text: question, at: Date.now() },
          ]),
          busy: true,
          lastError: null,
        }));

        const creds = await loadGeminiCredentials();
        if (!creds) {
          set({
            busy: false,
            lastError: 'Add your Gemini API key in Settings to use the assistant.',
          });
          return;
        }

        // Fresh map every request: real names in, labels out.
        const map = buildPseudonyms(collectClientNames());
        const history = get()
          .messages.slice(-CONTEXT_TURNS)
          .map((t) => ({ ...t, text: redactText(t.text, map) }));
        assertNoPii(
          history.map((t) => t.text).join('\n'),
          map
        );

        const outcome = await askSecretary(
          creds.apiKey,
          history,
          SECRETARY_TOOLS,
          buildToolRunner(map)
        );
        if (!outcome.ok) {
          set({ busy: false, lastError: outcome.error });
          return;
        }

        // Labels become real names again on device, right before display.
        const reply = restoreText(outcome.text, map);
        set((s) => ({
          messages: capTurns([
            ...s.messages,
            { role: 'model', text: reply, at: Date.now() },
          ]),
          busy: false,
          lastError: null,
        }));
      },

      clear: () => set({ messages: [], lastError: null }),
    }),
    {
      name: 'dayflow-secretary',
      version: PERSIST_VERSION,
      migrate: migrateStore,
      storage: createJSONStorage(() => AsyncStorage),
      // Runtime-only fields (busy/lastError) never persist — a killed app
      // must not come back stuck on "thinking".
      partialize: (s) => ({ messages: s.messages, enabled: s.enabled }),
    }
  )
);
