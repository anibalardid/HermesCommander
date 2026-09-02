import { Loader2, X } from '@/components/icons';
import { useTranslation } from 'react-i18next';

interface DiffModalProps {
  file: string | null;
  diff: string | null;
  loading?: boolean;
  onClose: () => void;
}

/** Shared colorized diff modal — used by the source-control tab and the PR files-changed view. */
export function DiffModal({ file, diff, loading, onClose }: DiffModalProps) {
  const { t } = useTranslation();
  if (!file) return null;
  const isLoading = loading ?? diff === null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <span className="truncate font-mono text-xs text-foreground/90">{file}</span>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-black/90 font-mono text-[11px] leading-relaxed">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-4 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
            </div>
          ) : diff ? (
            diff.split('\n').map((line, i) => {
              let cls = 'text-muted-foreground/70';
              if (line.startsWith('+')) cls = 'bg-green-500/20 text-green-300';
              else if (line.startsWith('-')) cls = 'bg-red-500/20 text-red-300';
              else if (line.startsWith('@@')) cls = 'bg-violet-500/15 text-violet-300';
              else if (line.startsWith('diff --git') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) cls = 'text-muted-foreground/60';
              return (
                <div key={i} className={`whitespace-pre px-3 ${cls}`}>{line || ' '}</div>
              );
            })
          ) : (
            <div className="p-4 text-xs text-muted-foreground">{t('pr.noDiff')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
