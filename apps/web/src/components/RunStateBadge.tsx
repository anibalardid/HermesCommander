import { useTranslation } from 'react-i18next';
import {
  Loader2, Clock, Pause, XCircle, UserX, CheckCircle2,
  Brain, GitBranch, Workflow, Eye,
} from '@/components/icons';

const RUN_META: Record<string, { icon: typeof Loader2; cls: string; spin?: boolean }> = {
  idle: { icon: Clock, cls: 'text-muted-foreground' },
  planning: { icon: Brain, cls: 'text-violet-500' },
  delegating: { icon: GitBranch, cls: 'text-sky-500' },
  running: { icon: Loader2, cls: 'text-green-500', spin: true },
  waiting: { icon: Workflow, cls: 'text-blue-500' },
  waiting_review: { icon: Eye, cls: 'text-cyan-500' },
  paused: { icon: Pause, cls: 'text-yellow-500' },
  failed: { icon: XCircle, cls: 'text-red-500' },
  waiting_user: { icon: UserX, cls: 'text-orange-500' },
  done: { icon: CheckCircle2, cls: 'text-green-600' },
};

/**
 * Small badge showing a task's execution sub-state (run_state) with an icon
 * and color, so the kanban is readable at a glance. Only the icon spins for
 * `running` — never the label text.
 *
 * When `alive` is provided and the state is an active one (running/delegating/
 * planning/waiting/...), a `false` value means the task is marked active but
 * has NO live OS process behind it (stale/crashed after a restart) — the badge
 * turns red and shows a "no process" marker so you know it's not really
 * running even though the board says so.
 */
export function RunStateBadge({ state, alive }: { state: string; alive?: boolean }) {
  const { t } = useTranslation();
  const meta = RUN_META[state] ?? RUN_META.idle;
  const Icon = meta.icon;
  const activeStates = ['planning', 'delegating', 'running', 'waiting', 'waiting_review', 'waiting_user', 'paused'];
  const stale = alive === false && activeStates.includes(state);
  return (
    <span
      title={stale ? `${t(`task.runState.${state}`)} — ${t('task.runState.runStateStale')}` : t(`task.runState.${state}`)}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
        stale ? 'border-red-500/50 bg-red-500/10 text-red-500' : 'border-border/60 bg-background/60'
      } ${stale ? '' : meta.cls}`}
    >
      <Icon className={`h-3 w-3 ${meta.spin && !stale ? 'animate-spin' : ''}`} />
      <span>{stale ? t('task.runState.runStateStale') : t(`task.runState.${state}`)}</span>
    </span>
  );
}
