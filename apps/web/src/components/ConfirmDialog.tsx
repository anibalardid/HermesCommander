import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import { X } from '@/components/icons';

/**
 * Reusable confirmation modal for destructive/irreversible actions
 * (delete, stop, pause). Renders a title, message, and Cancel/Confirm.
 * Optionally supports a secondary confirm action (e.g. "delete only the task"
 * vs "delete task and worktree") via secondaryConfirmLabel/onSecondaryConfirm.
 */
export function ConfirmDialog({
  open, title, message, confirmLabel, destructive = true, hideCancel = false,
  secondaryConfirmLabel, onSecondaryConfirm, onConfirm, onCancel, children,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  hideCancel?: boolean;
  secondaryConfirmLabel?: string;
  onSecondaryConfirm?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onCancel} aria-label={t('common.close')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{message}</p>
        {children}
        <div className="flex flex-wrap justify-end gap-2">
          {!hideCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>{t('common.cancel')}</Button>
          )}
          {secondaryConfirmLabel && onSecondaryConfirm && (
            <Button variant="outline" size="sm" onClick={() => { onSecondaryConfirm(); onCancel(); }}>
              {secondaryConfirmLabel}
            </Button>
          )}
          <Button
            variant={destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={() => { onConfirm(); onCancel(); }}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
