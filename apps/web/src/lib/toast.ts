import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'info';

export type Toast = {
  id: number;
  variant: ToastVariant;
  message: string;
};

type ToastState = {
  toasts: Toast[];
  push: (variant: ToastVariant, message: string) => void;
  dismiss: (id: number) => void;
};

const AUTO_DISMISS_MS = 4000;

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (variant, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, variant, message }] }));
    // Auto-dismiss after ~4s. The timer is fire-and-forget; if the toast was
    // already dismissed manually, the filter below is a no-op.
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, AUTO_DISMISS_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Module-level toast API — callable from anywhere (components, store actions,
 * plain async handlers) without a hook. Messages are already-translated
 * strings supplied by the caller.
 */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
};
