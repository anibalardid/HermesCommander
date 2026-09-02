import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, XCircle } from '@/components/icons';

export type Verdict = 'pass' | 'needs_changes' | 'reject';

const META: Record<Verdict, { labelKey: string; cls: string; Icon: typeof CheckCircle2 }> = {
  pass: { labelKey: 'task.verdictPass', cls: 'border-green-500/40 bg-green-500/10 text-green-600', Icon: CheckCircle2 },
  needs_changes: { labelKey: 'task.verdictNeedsChanges', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-600', Icon: AlertTriangle },
  reject: { labelKey: 'task.verdictReject', cls: 'border-red-500/40 bg-red-500/10 text-red-600', Icon: XCircle },
};

/** A compact verdict badge for a PR-review task. */
export function VerdictBadge({ verdict, className = '' }: { verdict: Verdict; className?: string }) {
  const { t } = useTranslation();
  const meta = META[verdict];
  const Icon = meta.Icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls} ${className}`}>
      <Icon className="h-3 w-3 shrink-0" />
      {t(meta.labelKey)}
    </span>
  );
}
