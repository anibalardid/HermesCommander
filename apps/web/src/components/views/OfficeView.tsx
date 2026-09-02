import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronDown, Plus, FolderGit2, Folder, LayoutDashboard, Search, GitPullRequest, AlertTriangle, Building2, Loader2, Menu } from '@/components/icons';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { NotificationBell } from '@/components/NotificationBell';
import type { ProblematicTask, GithubPr } from '@/lib/types';

export function OfficeView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const mobileNavOpen = useStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useStore((s) => s.setMobileNavOpen);
  const projects = useStore((s) => s.projects);
  const missions = useStore((s) => s.missions);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState({ total: 0, active: 0, done: 0, failed: 0 });
  const [problematic, setProblematic] = useState<ProblematicTask[]>([]);
  const [openPrs, setOpenPrs] = useState(0);
  const [prsLoading, setPrsLoading] = useState(true);
  const [missionStats, setMissionStats] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    api.getStats().then((r) => setStats(r.stats)).catch(() => {});
    api.listProblematicTasks().then((r) => setProblematic(r.tasks)).catch(() => {});
    api.listPrs()
      .then((r) => setOpenPrs(r.prs.filter((p: GithubPr) => p.state === 'OPEN').length))
      .catch(() => {})
      .finally(() => setPrsLoading(false));
  }, [missions]);

  // Load per-mission task-state counters for every project (same as the
  // project detail page) so the home shows 0/2/1/5 instead of a single badge.
  // Re-runs whenever the missions array changes (the WebSocket refreshes it
  // on state_change), so the dots/counters stay live without a page reload.
  useEffect(() => {
    const all: Record<string, Record<string, number>> = {};
    Promise.all(projects.map((p) =>
      api.getMissionStats(p.id).then((r) => { Object.assign(all, r.stats); }).catch(() => {}),
    )).finally(() => setMissionStats(all));
  }, [projects, missions]);

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="relative flex flex-col md:h-full md:overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Hamburger menu — mobile only, opens the nav drawer */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label={t('nav.openMenu')}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-drawer"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          >
            <Menu className="icon-anim h-5 w-5" />
          </button>
          <Link to="/" className="flex min-w-0 items-center gap-2 hover:opacity-80">
            <LayoutDashboard className="icon-anim hidden h-5 w-5 text-primary md:block" />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight">{t('office.title')}</h1>
              <p className="truncate text-xs text-muted-foreground">{t('office.subtitle')}</p>
            </div>
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {/* Search button — opens the global palette (Ctrl+K on desktop). */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-1.5 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t('search.title')}
          >
            <Search className="icon-anim h-5 w-5" />
            <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline">
              Ctrl+K
            </kbd>
          </button>

          {/* Notification bell — always visible on every breakpoint. */}
          <NotificationBell />
        </div>
      </header>

      {/* Stats row: projects + task counters (active blue, done green, failed red) */}
      <div className="grid grid-cols-2 gap-2 border-b px-4 py-3 md:grid-cols-4">
        <Stat label={t('office.totalProjects')} value={projects.length} />
        <Stat label={t('office.activeTasks')} value={stats.active} color="text-sky-500" />
        <Stat label={t('office.doneTasks')} value={stats.done} color="text-green-600" />
        <Stat label={t('office.failedTasks')} value={stats.failed} color="text-red-600" />
      </div>

      {/* Actions: Office + GitHub Tasks + Resume — all always visible */}
      <div className="border-b px-4 py-3">
        <div className="grid gap-2 md:grid-cols-3">
          {/* Office map tile */}
          <Link
            to="/office"
            className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t('nav.office')}</span>
              <span className="block text-xs text-muted-foreground">{t('office.officeSubtitle')}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          {/* Git Tasks tile */}
          <Link
            to="/tasks"
            className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitPullRequest className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{t('office.gitTasks')}</span>
              <span className="block text-xs text-muted-foreground">{t('office.gitTasksSubtitle')}</span>
            </span>
            {prsLoading ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
              </span>
            ) : openPrs > 0 ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {t('office.openPrs', { count: openPrs })}
              </span>
            ) : null}
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          {/* Resume card — always visible; shows the count of failed/blocked tasks */}
          <div className="rounded-lg border border-destructive/30 bg-card p-3">
            <Link
              to="/resume"
              className="group flex items-center gap-3"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t('office.resume')}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {problematic.length > 0
                    ? t('office.tasksNeedAttention', { count: problematic.length })
                    : t('office.noPendingTasks')}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>

      {/* Projects — each project is a card */}
      <div className="px-4 py-3 md:flex-1 md:overflow-y-auto">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground/80">
          <FolderGit2 className="h-3.5 w-3.5 text-primary" />
          {t('nav.projects')}
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{projects.length}</span>
          <button
            onClick={() => navigate('/new')}
            title={t('nav.addProject')}
            aria-label={t('nav.addProject')}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {projects.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t('office.noProjects')}
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const pMissions = missions.filter((m) => m.project_id === p.id);
              const isOpen = expanded[p.id];
              return (
                <div key={p.id} className="overflow-hidden rounded-lg border bg-card">
                  <button
                    onClick={() => toggle(p.id)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/50"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    {p.type === 'git' ? (
                      <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{pMissions.length}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t bg-muted/20">
                      {pMissions.length === 0 && (
                        <div className="px-10 py-2 text-xs text-muted-foreground">
                          {t('project.noMissions')}
                        </div>
                      )}
                      {pMissions.map((m) => (
                        <Link
                          key={m.id}
                          to={`/mission/${m.id}`}
                          className="flex items-center gap-2 px-10 py-2 text-sm hover:bg-accent/50"
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              m.state === 'running'
                                ? 'bg-green-500'
                                : m.state === 'failed'
                                  ? 'bg-red-500'
                                  : m.state === 'paused'
                                    ? 'bg-yellow-500'
                                    : 'bg-muted-foreground/50'
                            }`}
                          />
                          <span className="flex-1 truncate">{m.name}</span>
                          <MissionCounters stats={missionStats[m.id]} />
                        </Link>
                      ))}
                      {/* Add mission — visible on mobile where there's no sidebar/FAB */}
                      <Link
                        to={`/project/${p.id}/new-mission`}
                        className="flex items-center gap-2 px-10 py-2 text-sm font-medium text-primary hover:bg-accent/50"
                      >
                        <Plus className="h-4 w-4" />
                        {t('project.newMission')}
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-2 text-center">
      <div className={`text-xl font-bold ${color ?? ''}`}>{value}</div>
      <div className="text-[10px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

/** Per-mission task-state counters (todo/doing/blocked/done) with colors + tooltip. */
function MissionCounters({ stats }: { stats?: Record<string, number> }) {
  const { t } = useTranslation();
  const s = stats ?? { todo: 0, doing: 0, blocked: 0, done: 0 };
  const items = [
    { key: 'todo', label: t('task.state_todo'), cls: 'bg-slate-200 text-slate-700' },
    { key: 'doing', label: t('task.state_doing'), cls: 'bg-sky-500 text-white' },
    { key: 'blocked', label: t('task.state_blocked'), cls: 'bg-red-500 text-white' },
    { key: 'done', label: t('task.state_done'), cls: 'bg-green-500 text-white' },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {items.map((it) => (
        <span
          key={it.key}
          title={it.label}
          className={`rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${it.cls} ${
            (s[it.key] ?? 0) > 0 ? '' : 'opacity-40'
          }`}
        >
          {s[it.key] ?? 0}
        </span>
      ))}
    </div>
  );
}
