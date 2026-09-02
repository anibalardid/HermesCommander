import { X } from '@/components/icons';
import { cn, modalSheetCls } from '@/lib/utils';

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Sheet — bottom sheet on mobile, centered modal on desktop/tablet */}
      <div className={cn('relative z-10', modalSheetCls)}>
        {/* Drag handle — only on mobile */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-accent" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SheetField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export const sheetInputCls =
  'w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring';
