import { useToastStore, type ToastVariant } from '@/lib/toast';
import { CheckCircle2, XCircle, Info, X } from '@/components/icons';

const VARIANT_META: Record<ToastVariant, { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'border-green-500/60 bg-green-600 text-white' },
  error: { icon: XCircle, cls: 'border-red-500/60 bg-red-600 text-white' },
  info: { icon: Info, cls: 'border-border bg-card text-foreground' },
};

/**
 * Global toast host. Mounted once in AppShell so it is available on every
 * route. Toasts stack top-right, auto-dismiss, and can be dismissed by
 * clicking anywhere on the toast (or the explicit close button). The container
 * is `pointer-events-none` so it never blocks interaction with the app.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => {
        const meta = VARIANT_META[t.variant];
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            role="status"
            onClick={() => dismiss(t.id)}
            className={`toast-enter pointer-events-auto flex cursor-pointer items-start gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-lg ${meta.cls}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words text-sm">{t.message}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
              className="shrink-0 rounded p-0.5 text-current opacity-70 transition-opacity hover:bg-white/20 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
