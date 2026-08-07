import { create } from 'zustand';

interface UndoEntry {
  id: number;
  message: string;
  onUndo: () => void;
}

interface UndoState {
  current: UndoEntry | null;
  /** Show an undo toast for ~5s. A new toast replaces the previous one. */
  show: (message: string, onUndo: () => void) => void;
  /** Run the pending undo action and dismiss. */
  undo: () => void;
  dismiss: (id?: number) => void;
}

let counter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Lightweight global undo toast (not persisted). Destructive actions call
 * `showUndo('Task deleted', () => restore())`; the host renders the toast.
 */
export const useUndo = create<UndoState>()((set, get) => ({
  current: null,

  show: (message, onUndo) => {
    if (timer) clearTimeout(timer);
    const id = ++counter;
    set({ current: { id, message, onUndo } });
    timer = setTimeout(() => get().dismiss(id), 5000);
  },

  undo: () => {
    const entry = get().current;
    if (!entry) return;
    if (timer) clearTimeout(timer);
    set({ current: null });
    entry.onUndo();
  },

  dismiss: (id) =>
    set((s) => {
      if (id != null && s.current?.id !== id) return s;
      if (timer) clearTimeout(timer);
      return { current: null };
    }),
}));

export function showUndo(message: string, onUndo: () => void): void {
  useUndo.getState().show(message, onUndo);
}
