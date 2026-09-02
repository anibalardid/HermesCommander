import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentLogEntry, Task } from '@/lib/types';

export function LogsTab({ logs, tasks = [] }: { logs: AgentLogEntry[]; tasks?: Task[] }) {
  const { t } = useTranslation();
  const [logQuery, setLogQuery] = useState('');
  const [logLevel, setLogLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const [taskFilter, setTaskFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  // Distinct dates (YYYY-MM-DD) present in the logs, newest first.
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const l of logs) {
      const d = new Date(l.created_at);
      if (!isNaN(d.getTime())) set.add(d.toISOString().slice(0, 10));
    }
    return Array.from(set).sort().reverse();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = logQuery.trim().toLowerCase();
    return logs.filter((l) => {
      if (logLevel !== 'all' && l.level !== logLevel) return false;
      if (taskFilter !== 'all' && l.task_id !== taskFilter) return false;
      if (dateFilter !== 'all') {
        const d = new Date(l.created_at);
        if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateFilter) return false;
      }
      if (q && !l.message.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, logLevel, taskFilter, dateFilter, logQuery]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search + level filter */}
      <div className="mb-2 flex gap-1.5">
        <input
          value={logQuery}
          onChange={(e) => setLogQuery(e.target.value)}
          placeholder={t('mission.logSearch')}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={logLevel}
          onChange={(e) => setLogLevel(e.target.value as typeof logLevel)}
          className="shrink-0 rounded-md border border-input bg-background px-1.5 py-1 text-xs focus:outline-none"
        >
          <option value="all">{t('mission.logAll')}</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </div>

      {/* Task + date filters */}
      <div className="mb-2 flex gap-1.5">
        <select
          value={taskFilter}
          onChange={(e) => setTaskFilter(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-xs focus:outline-none"
        >
          <option value="all">{t('mission.logAllTasks')}</option>
          {tasks.map((x) => (
            <option key={x.id} value={x.id}>{x.title}</option>
          ))}
        </select>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="shrink-0 rounded-md border border-input bg-background px-1.5 py-1 text-xs focus:outline-none"
        >
          <option value="all">{t('mission.logAllDates')}</option>
          {dates.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto rounded bg-black/90 p-3 font-mono text-xs text-green-400">
        {logs.length === 0 ? (
          <span className="text-muted-foreground">{t('common.empty')}</span>
        ) : filtered.length === 0 ? (
          <span className="text-muted-foreground">{t('mission.logNoMatch')}</span>
        ) : (
          filtered.map((l, i) => (
            <div key={i} className="border-b border-white/5 pb-1 last:border-0">
              <div className="flex gap-1.5 text-[10px] uppercase text-green-600/70">
                <span className="shrink-0 tabular-nums">{new Date(l.created_at).toLocaleString()}</span>
                <span className={l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-green-600/70'}>
                  [{l.level}]
                </span>
                <span className="shrink-0">{l.source}</span>
              </div>
              <div className="whitespace-pre-wrap break-words">{l.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
