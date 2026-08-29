import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ask as askBrain, loadBrain } from '../lib/secretaryBrain';
import type { ChatTurn } from '../lib/secretaryPrompt';
import {
  assertNoPii,
  buildPseudonyms,
  redactText,
  restoreText,
} from '../lib/secretaryPrivacy';
import {
  buildToolRunner,
  collectClientNames,
  buildInboxDigest,
  secretaryTools,
  type SecretaryAction,
} from '../lib/secretaryTools';
import { PERSIST_VERSION, migrateStore } from './persistVersion';
import { useSettings } from './settings';

/**
 * The AI secretary's conversation.
 *
 * Two texts exist for every turn and they are never confused:
 * - the LOCAL one, with real client names, which is what gets persisted and
 *   shown on screen. It never leaves the device.
 * - the WIRE one, rebuilt from scratch on every request by running the local
 *   text through a fresh pseudonym map, which is all the model ever sees.
 *
 * The map is rebuilt per request from the current client list, so labels are
 * only meaningful inside one exchange. The whole (trimmed) history is
 * re-redacted with that same map each time, which keeps the conversation
 * self-consistent for the model without ever storing a wire transcript.
 *
 * The model may also PROPOSE a message or a booking. Proposals are collected
 * in a per-request sink, resolved to real names here, and attached to the
 * assistant turn for the UI to offer. Nothing is ever sent or booked without
 * the user confirming it on the screen that owns the action.
 */

/** Turns kept on device (a turn is one user or one model message). */
const MAX_TURNS = 40;
/** Turns sent as context — enough for follow-ups, small enough to stay cheap. */
const CONTEXT_TURNS = 20;
/** Proposals shown under one answer. A wall of cards is not a suggestion. */
const MAX_ACTIONS = 4;

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

        const brain = await loadBrain();
        if (!brain) {
          set({
            busy: false,
            lastError: 'Add your Anthropic API key in Settings to use the assistant.',
          });
          return;
        }

        // Fresh map every request: real names in, labels out.
        const map = buildPseudonyms(collectClientNames());
        // Rebuilt from the local text only: `mentions` and `actions` are
        // on-device display state in REAL names and must never go back out.
        const history: ChatTurn[] = get()
          .messages.slice(-CONTEXT_TURNS)
          .map((t) => ({ role: t.role, at: t.at, text: redactText(t.text, map) }));

        // The inbox picture rides in FRONT of the conversation, as its own
        // turn, so it reads as background the assistant was handed rather
        // than as something the user said. Rebuilt every request: a snapshot
        // from ten minutes ago is worse than none, because it looks current.
        const { secretaryPreloadChats } = useSettings.getState().settings;
        if (secretaryPreloadChats) {
          const digest = buildInboxDigest(map);
          if (digest) {
            history.unshift({ role: 'user', at: Date.now(), text: digest });
            history.splice(1, 0, {
              role: 'model',
              at: Date.now(),
              text: 'Understood, I have the current inbox in mind.',
            });
          }
        }
        assertNoPii(
          history.map((t) => t.text).join('\n'),
          map
        );

        // A fresh sink per request. Write tools only PROPOSE into this — the
        // model cannot send or book anything by itself.
        const proposals: SecretaryAction[] = [];
        // The notes tool is absent, not merely refused, when the user has not
        // opted in — the model cannot call what it was never offered.
        const { secretaryUsesNotes: usesNotes, secretaryReadsMessages: readsMessages } =
          useSettings.getState().settings;
        const outcome = await askBrain(
          brain,
          history,
          secretaryTools(usesNotes, readsMessages),
          buildToolRunner(map, proposals)
        );
        if (!outcome.ok) {
          set({ busy: false, lastError: outcome.error });
          return;
        }

        // Labels become real names again on device, right before display.
        const reply = restoreText(outcome.text, map);
        // Which clients did it actually name? Those get one-tap chips.
        const mentions = map.entries
          .filter((e) => reply.includes(e.real))
          .map((e) => e.real);

        // Proposals come back labelled ("Client 3"); the real name is put on
        // here, on device. A label the map cannot resolve is a hallucinated
        // client — drop it rather than show a card for nobody. Draft bodies
        // are written by the model and carry labels too, so they get the same
        // restore pass as the answer text.
        const actions: SecretaryAction[] = [];
        for (const p of proposals) {
          if (actions.length >= MAX_ACTIONS) break;
          const client = map.toReal(p.label);
          if (!client) continue;
          actions.push({
            ...p,
            client,
            ...(p.text != null ? { text: restoreText(p.text, map) } : {}),
          });
        }

        set((s) => ({
          messages: capTurns([
            ...s.messages,
            {
              role: 'model',
              text: reply,
              at: Date.now(),
              ...(mentions.length > 0 ? { mentions } : {}),
              ...(actions.length > 0 ? { actions } : {}),
            },
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
