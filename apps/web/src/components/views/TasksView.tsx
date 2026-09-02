import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, GitPullRequest, Search, RefreshCw, GitBranch, GitMerge, GitPullRequestClosed, AlertTriangle } from '@/components/icons';
import { api } from '@/lib/api';
import { NotificationBell } from '@/components/NotificationBell';
import type { GithubPr, PrState } from '@/lib/types';

const STATE_META: Record<PrState, { label: string; cls: string; icon: typeof GitPullRequest }> = {
  OPEN: { label: 'Open', cls: 'bg-green-500/15 text-green-600', icon: GitPullRequest },
  DRAFT: { label: 'Draft', cls: 'bg-muted text-muted-foreground', icon: GitPullRequestClosed },
  MERGED: { label: 'Merged', cls: 'bg-purple-500/15 text-purple-600', icon: GitMerge },
  CLOSED: { label: 'Closed', cls: 'bg-red-500/15 text-red-600', icon: GitPullRequestClosed },
};

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function TasksView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [prs, setPrs] = useState<GithubPr[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<PrState | 'ALL'>('ALL');
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [searchParams] = useSearchParams();

  const load = () => {
    setLoading(true);
    setError(null);
    api.listPrs().then((r) => setPrs(r.prs)).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Support ?project=<name> (from the sidebar's per-project git icon) to
  // pre-filter the PR list to that project.
  useEffect(() => {
    const p = searchParams.get('project');
    if (p) setProjectFilter(p);
  }, [searchParams]);

  const projects = useMemo(() => Array.from(new Set(prs.map((p) => p.projectName))).sort(), [prs]);

  const filtered = useMemo(() => {
    let out = prs;
    if (stateFilter !== 'ALL') out = out.filter((p) => p.state === stateFilter);
    if (projectFilter !== 'ALL') out = out.filter((p) => p.projectName === projectFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((p) =>
        p.title.toLowerCase().includes(q) ||
        p.branch?.toLowerCase().includes(q) ||
        p.author?.toLowerCase().includes(q) ||
        String(p.number).includes(q)
      );
    }
    // Most recently updated first.
    return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [prs, stateFilter, projectFilter, query]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => navigate('/')} className="rounded-md p-1 hover:bg-accent" aria-label={t('common.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight">{t('office.gitTasksTitle')}</h1>
          <p className="truncate text-xs text-muted-foreground">{t('office.subtitle')}</p>
        </div>
        <button onClick={load} className="rounded-md p-2 text-muted-foreground hover:bg-accent" title="Refresh" aria-label="Refresh">
          <RefreshCw className={`icon-anim h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <NotificationBell />
      </header>

      {/* Search */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('office.searchPrs')}
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b px-4 py-2">
        {(['ALL', 'OPEN', 'DRAFT', 'MERGED', 'CLOSED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStateFilter(s)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              stateFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'ALL' ? t('office.all') : STATE_META[s as PrState].label}
          </button>
        ))}
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="shrink-0 rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground focus:outline-none"
        >
          <option value="ALL">{t('office.allProjects')}</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && prs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="icon-anim h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-500">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{t('common.empty')}</div>
        ) : (
          <div className="divide-y">
            {filtered.map((pr) => {
              const meta = STATE_META[pr.state];
              const Icon = meta.icon;
              return (
                <Link
                  key={`${pr.projectId}-${pr.number}`}
                  to={`/pr/${pr.projectId}/${pr.number}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50"
                >
                  <span className={`shrink-0 rounded-md p-1.5 ${meta.cls}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{pr.title}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      <span className="font-mono">#{pr.number}</span>
                      {pr.branch && <span className="ml-1.5 inline-flex items-center gap-1"><GitBranch className="h-3 w-3" />{pr.branch}</span>}
                      <span className="mx-1.5">·</span>
                      {pr.projectName}
                      <span className="mx-1.5">·</span>
                      {pr.author ?? 'unknown'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {pr.mergeable === 'CONFLICTING' && (
                      <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                        <AlertTriangle className="h-3 w-3" /> {t('pr.conflict')}
                      </span>
                    )}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{formatRelative(pr.updatedAt)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
