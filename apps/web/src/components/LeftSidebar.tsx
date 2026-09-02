import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Settings, Building2, HelpCircle, Home, GitPullRequest, AlertTriangle, FolderGit2, Plus, Trash2, MessageCircle } from '@/components/icons';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { missionDotColor } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function LeftSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const missions = useStore((s) => s.missions);
  const deleteProject = useStore((s) => s.deleteProject);
  const setChatOpen = useStore((s) => s.setChatOpen);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  // Per-project mission task-state counters, keyed by mission id.
  const [missionStats, setMissionStats] = useState<Record<string, Record<string, number>>>({});

  // Load per-mission task-state counts for the colored status dots.
  useEffect(() => {
    let cancelled = false;
    Promise.all(projects.map((p) => api.getMissionStats(p.id).then((r) => r.stats).catch(() => ({}))))
      .then((all) => {
        if (cancelled) return;
        const merged: Record<string, Record<string, number>> = {};
        for (const s of all) Object.assign(merged, s);
        setMissionStats(merged);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projects]);

  const handleNav = () => onNavigate?.();

  return (
    <aside className="flex h-full w-full flex-col border-r bg-muted/30">
      <Link to="/" onClick={handleNav} className="flex items-center gap-2 border-b px-4 py-3 hover:opacity-80">
        <Building2 className="icon-anim h-5 w-5 text-primary" />
        <span className="font-semibold">{t('app.name')}</span>
      </Link>

      <nav className="flex-1 overflow-y-auto p-2">
        {/* Home shortcut */}
        <div className="mb-1">
          <NavLink
            to="/"
            end
            onClick={handleNav}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`
            }
          >
            <Home className="icon-anim h-4 w-4 text-primary" />
            <span className="truncate">{t('nav.home')}</span>
          </NavLink>
        </div>

        {/* Office map shortcut */}
        <div className="mb-1">
          <NavLink
            to="/office"
            onClick={handleNav}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`
            }
          >
            <Building2 className="icon-anim h-4 w-4 text-primary" />
            <span className="truncate">{t('nav.office')}</span>
          </NavLink>
        </div>

        {/* Git Tasks shortcut */}
        <div className="mb-1">
          <NavLink
            to="/tasks"
            onClick={handleNav}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`
            }
          >
            <GitPullRequest className="icon-anim h-4 w-4 text-primary" />
            <span className="truncate">{t('office.gitTasks')}</span>
          </NavLink>
        </div>

        {/* Resume shortcut */}
        <div className="mb-1">
          <NavLink
            to="/resume"
            onClick={handleNav}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
              }`
            }
          >
            <AlertTriangle className="icon-anim h-4 w-4 text-primary" />
            <span className="truncate">{t('office.resume')}</span>
          </NavLink>
        </div>

        <div className="mb-1 mt-5 flex items-center gap-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-foreground/80">
          <FolderGit2 className="h-3.5 w-3.5 text-primary" />
          {t('nav.projects')}
          <button
            onClick={() => navigate('/new')}
            title={t('nav.addProject')}
            aria-label={t('nav.addProject')}
            className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {projects.length === 0 && (
          <div className="px-2 py-1 text-sm text-muted-foreground">{t('office.noProjects')}</div>
        )}
        {projects.map((p) => {
          const pMissions = missions.filter((m) => m.project_id === p.id);
          return (
            <div key={p.id} className="mb-1 group">
              <div className="flex items-center gap-1">
                <NavLink
                  to={`/project/${p.id}`}
                  onClick={handleNav}
                  className={({ isActive }) =>
                    `flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent ${
                      isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
                    }`
                  }
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <span className="truncate">{p.name}</span>
                </NavLink>
                {/* Per-project actions: add mission, delete project, view PRs.
                    Always visible on mobile (no hover); hover-reveal on desktop. */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
                  <button
                    onClick={() => navigate(`/project/${p.id}/new-mission`)}
                    title={t('nav.addMission')}
                    aria-label={t('nav.addMission')}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                    title={t('nav.deleteProject')}
                    aria-label={t('nav.deleteProject')}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => navigate(`/tasks?project=${encodeURIComponent(p.name)}`)}
                    title={t('nav.viewPrs')}
                    aria-label={t('nav.viewPrs')}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <GitPullRequest className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {pMissions.map((m) => (
                <NavLink
                  key={m.id}
                  to={`/mission/${m.id}`}
                  onClick={handleNav}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md py-1 pl-5 pr-2 text-sm hover:bg-accent ${
                      isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
                    }`
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${missionDotColor(missionStats[m.id])}`} />
                  <span className="truncate">{m.name}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="border-t p-2">
        {/* Quick chat — opens the Hermes chat panel (no floating FAB anymore). */}
        <button
          onClick={() => setChatOpen(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
        >
          <MessageCircle className="icon-anim h-4 w-4" /> {t('nav.quickChat')}
        </button>
        <NavLink
          to="/settings"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
        >
          <Settings className="icon-anim h-4 w-4" /> {t('nav.settings')}
        </NavLink>
        <NavLink
          to="/help"
          className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
        >
          <HelpCircle className="icon-anim h-4 w-4" /> {t('nav.help')}
        </NavLink>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('nav.deleteProject')}
        message={t('office.confirmDeleteProject', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteTarget) void deleteProject(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  );
}
