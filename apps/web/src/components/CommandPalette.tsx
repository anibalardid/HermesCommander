import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Folder, Target, CheckSquare, CornerDownLeft } from '@/components/icons';
import { api } from '@/lib/api';
import type { Project, Mission, Task } from '@/lib/types';
import { cn } from '@/lib/utils';

type Result = {
  kind: 'project' | 'mission' | 'task';
  id: string;
  title: string;
  subtitle?: string;
  to: string;
};

/**
 * Global command palette (Ctrl+K / Cmd+K). Searches projects, missions, and
 * tasks across the whole app and navigates to the selected result.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api.search(q);
        const items: Result[] = [
          ...res.projects.map((p: Project) => ({
            kind: 'project' as const, id: p.id, title: p.name,
            subtitle: p.path, to: `/project/${p.id}`,
          })),
          ...res.missions.map((m: Mission) => ({
            kind: 'mission' as const, id: m.id, title: m.name,
            subtitle: m.objective, to: `/mission/${m.id}`,
          })),
          ...res.tasks.map((task: Task) => ({
            kind: 'task' as const, id: task.id, title: task.title,
            subtitle: task.description ?? '', to: `/mission/${task.mission_id}`,
          })),
        ];
        setResults(items);
        setHighlight(0);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Focus input when opened.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      // Focus after the palette mounts (it returns null when closed, so the
      // input only exists once open). requestAnimationFrame is more reliable
      // than setTimeout(0) for post-mount focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep highlight in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const grouped = useMemo(() => {
    const g: { label: string; items: Result[] }[] = [];
    const sections: Array<[Result['kind'], string]> = [
      ['project', t('search.projects')],
      ['mission', t('search.missions')],
      ['task', t('search.tasks')],
    ];
    for (const [kind, label] of sections) {
      const items = results.filter((r) => r.kind === kind);
      if (items.length) g.push({ label, items });
    }
    return g;
  }, [results, t]);

  function go(r: Result) {
    onClose();
    navigate(r.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) go(results[highlight]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  const iconFor = (kind: Result['kind']) =>
    kind === 'project' ? <Folder className="icon-anim h-4 w-4 shrink-0 text-primary" /> :
    kind === 'mission' ? <Target className="icon-anim h-4 w-4 shrink-0 text-primary" /> :
    <CheckSquare className="icon-anim h-4 w-4 shrink-0 text-primary" />;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('search.placeholder')}
            className="w-full bg-transparent py-3 text-sm focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-1">
          {query.trim() && results.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t('search.noResults')}</div>
          )}
          {!query.trim() && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t('search.hint')}</div>
          )}
          {grouped.map((section) => (
            <div key={section.label}>
              <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase text-muted-foreground">
                {section.label}
              </div>
              {section.items.map((r) => {
                const idx = results.indexOf(r);
                return (
                  <button
                    key={`${r.kind}-${r.id}`}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => go(r)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
                      idx === highlight ? 'bg-accent text-accent-foreground' : 'text-foreground'
                    )}
                  >
                    {iconFor(r.kind)}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.title}</span>
                      {r.subtitle && (
                        <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                      )}
                    </span>
                    {idx === highlight && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
