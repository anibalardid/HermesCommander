import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertTriangle, Loader2, RefreshCw } from '@/components/icons';
import { api } from '@/lib/api';
import { NotificationBell } from '@/components/NotificationBell';
import type { ProblematicTask } from '@/lib/types';

export function ResumeView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<ProblematicTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.listProblematicTasks()
      .then((r) => setTasks(r.tasks))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => navigate('/')} className="rounded-md p-1 hover:bg-accent" aria-label={t('common.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">{t('office.resume')}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {t('office.resumeSubtitle', { count: tasks.length })}
          </p>
        </div>
        <button onClick={load} className="rounded-md p-2 text-muted-foreground hover:bg-accent" title="Refresh" aria-label="Refresh">
          <RefreshCw className={`icon-anim h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <NotificationBell />
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && tasks.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="icon-anim h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-500">{error}</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-8 w-8 text-green-500" />
            {t('office.noPendingTasks')}. {t('office.allClear')}
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((pt) => {
              // Determine the problem kind: a review verdict that needs action
              // (needs_changes → orange, reject → red), else failed (red) or
              // blocked (yellow).
              const verdict = pt.task.review_verdict;
              const kind =
                verdict === 'needs_changes' ? 'needs_changes'
                : verdict === 'reject' ? 'reject'
                : pt.task.run_state === 'failed' ? 'failed'
                : 'blocked';
              const dot = {
                needs_changes: 'bg-orange-500',
                reject: 'bg-red-500',
                failed: 'bg-red-500',
                blocked: 'bg-yellow-500',
              }[kind];
              const badge = {
                needs_changes: 'bg-orange-500/15 text-orange-600',
                reject: 'bg-red-500/15 text-red-600',
                failed: 'bg-red-500/15 text-red-600',
                blocked: 'bg-yellow-500/15 text-yellow-600',
              }[kind];
              const label = {
                needs_changes: t('office.taskStateNeedsChanges'),
                reject: t('office.taskStateRejected'),
                failed: t('office.taskStateFailed'),
                blocked: t('office.taskStateBlocked'),
              }[kind];
              return (
                <Link
                  key={pt.task.id}
                  to={`/mission/${pt.missionId}`}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 hover:bg-accent/40"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{pt.task.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {pt.missionName ?? pt.projectName}
                      {pt.projectName ? ` · ${pt.projectName}` : ''}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge}`}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
