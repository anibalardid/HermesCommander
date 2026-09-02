import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Pencil, Trash2, GitBranch, PanelRight, ExternalLink, GitPullRequest, Menu } from '@/components/icons';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { NotificationBell } from '@/components/NotificationBell';
import { Badge, Button } from '@/components/ui';
import { githubRepoUrl, missionDotColor } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BottomSheet, SheetField, sheetInputCls } from '@/components/BottomSheet';
import { WorkspacePanel, readSavedWidth, saveWidth } from '@/components/workspace/WorkspacePanel';
import { makeProjectSourceApi } from '@/components/workspace/SourceControlTab';
import { makeProjectFilesApi } from '@/components/workspace/FilesTab';

export function ProjectDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const allMissions = useStore((s) => s.missions);
  const missions = allMissions.filter((m) => m.project_id === id);
  const deleteProject = useStore((s) => s.deleteProject);
  const updateProject = useStore((s) => s.updateProject);
  const mobileNavOpen = useStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useStore((s) => s.setMobileNavOpen);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSetup, setEditSetup] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState<number>(readSavedWidth);
  const [missionStats, setMissionStats] = useState<Record<string, Record<string, number>>>({});

  // Load per-mission task-state counts for the colored counters. Re-runs
  // whenever the missions array changes (the WebSocket refreshes it on
  // state_change), so the dots/counters stay live without a page reload.
  useEffect(() => {
    if (!id) return;
    api.getMissionStats(id).then((r) => setMissionStats(r.stats)).catch(() => {});
  }, [id, allMissions]);

  // Persist the workspace width across opens.
  useEffect(() => {
    saveWidth(workspaceWidth);
  }, [workspaceWidth]);

  if (!project) return <div className="p-6 text-muted-foreground">{t('common.loading')}</div>;
  const proj = project;

  function openEdit() {
    setEditName(proj.name);
    setEditSetup(proj.setup_script ?? '');
    setEditDescription(proj.description ?? '');
    setEditOpen(true);
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Header with back */}
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {/* Hamburger menu — mobile only, opens the nav drawer (first) */}
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
        <button onClick={() => navigate('/')} className="rounded-md p-1 hover:bg-accent" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold leading-tight">{project.name}</h1>
              {/* Action icons — inline with the title */}
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={openEdit}
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => navigate(`/tasks?project=${encodeURIComponent(project.name)}`)}
                  title={t('nav.viewPrs')}
                  aria-label={t('nav.viewPrs')}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {project.description ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">{project.description}</p>
            ) : null}
          </div>
        </div>
        {/* Workspace toggle — right-aligned, same on all breakpoints */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={() => setWorkspaceOpen((v) => !v)}
            size="sm" variant={workspaceOpen ? 'default' : 'outline'}
            className="active:scale-95"
            aria-label={t('workspace.title')}
            title={t('workspace.title')}
          >
            <PanelRight className="icon-anim h-4 w-4" />
          </Button>
          <NotificationBell />
        </div>
      </header>

      {/* Branch */}
      {project.type === 'git' && (() => {
        const url = githubRepoUrl(project.remote_url, project.branch);
        return (
          <div className="flex items-center gap-1.5 border-b px-4 py-1.5 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="font-mono">{t('project.branch')}: {project.branch ?? 'main'}</span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground"
                title={t('project.openInGit')}
                aria-label={t('project.openInGit')}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        );
      })()}

      <div className="relative flex flex-1 overflow-hidden">
        {/* Missions list */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {/* New mission button — above the missions list, left-aligned */}
          <div className="flex justify-start border-b px-4 py-3">
            <Link
              to={`/project/${id}/new-mission`}
              className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="h-4 w-4" /> {t('project.newMission')}
            </Link>
          </div>
          {missions.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">{t('project.noMissions')}</div>
          )}
          {missions.map((m) => (
            <Link
              key={m.id}
              to={`/mission/${m.id}`}
              className="flex items-center gap-3 border-b px-4 py-3 hover:bg-accent/50"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${missionDotColor(missionStats[m.id])}`} />
              <div className="flex-1">
                <div className="font-medium">{m.name}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{m.objective}</div>
              </div>
              <MissionCounters stats={missionStats[m.id]} />
            </Link>
          ))}
        </div>

        {/* Workspace panel (Source control + Files over the whole project repo) */}
        <WorkspacePanel
          open={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          scope="project"
          sourceApi={makeProjectSourceApi(project.id)}
          filesApi={makeProjectFilesApi(project.id)}
          width={workspaceWidth}
          onWidthChange={setWorkspaceWidth}
          cwd={proj.path || undefined}
        />
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDelete}
        title={t('project.deleteTitle')}
        message={t('project.deleteMsg', { name: project.name })}
        onConfirm={() => { void deleteProject(project.id).then(() => navigate('/')); }}
        onCancel={() => setConfirmDelete(false)}
      />

      {/* Edit project */}
      {editOpen && (
        <BottomSheet open onClose={() => setEditOpen(false)} title={t('project.editTitle')}>
          <div className="space-y-4">
            <SheetField label={t('project.name')}>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className={sheetInputCls} />
            </SheetField>
            <SheetField label={t('project.description')}>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className={sheetInputCls}
                rows={3}
                placeholder={t('project.descriptionPlaceholder')}
              />
            </SheetField>
            <SheetField label={t('project.setupScript')}>
              <textarea
                value={editSetup}
                onChange={(e) => setEditSetup(e.target.value)}
                className={sheetInputCls}
                rows={5}
                placeholder="export FOO=bar&#10;cp .env.example .env"
              />
            </SheetField>
            <button
              onClick={() => {
                void updateProject(project.id, { name: editName, setupScript: editSetup, description: editDescription }).then(() => setEditOpen(false));
              }}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('common.save')}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

function stateBadgeClass(state: string): string {
  switch (state) {
    case 'running': return 'bg-green-600 text-white';
    case 'paused': return 'bg-yellow-600 text-white';
    case 'failed': return 'bg-red-600 text-white';
    case 'done': return 'bg-blue-600 text-white';
    default: return '';
  }
}

/** Colored task-state counters for a mission: todo / doing / blocked / done.
 *  Each number is colored by its state and shows a tooltip on hover. */
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
