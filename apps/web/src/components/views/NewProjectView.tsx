import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, GitBranch, Loader2, XCircle } from '@/components/icons';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { Button } from '@/components/ui';
import { BottomSheet, SheetField, sheetInputCls } from '@/components/BottomSheet';
import { FolderPicker } from '@/components/FolderPicker';

type Scan = { isGitRepo: boolean; branch: string | null };
/** What to do with the path once scanned (only shown when it's NOT a git repo). */
type NoGitChoice = 'no-git' | 'clone' | 'create';

export function NewProjectView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createProject = useStore((s) => s.createProject);
  const projects = useStore((s) => s.projects);

  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [noGitChoice, setNoGitChoice] = useState<NoGitChoice>('no-git');
  // "Add existing repo" → clone a remote URL into the chosen path.
  const [cloneUrl, setCloneUrl] = useState('');
  // "Create new repo" → name + owner (user/org) + visibility.
  const [repoName, setRepoName] = useState('');
  const [owner, setOwner] = useState('');
  const [owners, setOwners] = useState<{ user: string | null; orgs: string[] }>({ user: null, orgs: [] });
  const [githubVisibility, setGithubVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load GitHub owners (user + orgs) once on mount.
  useEffect(() => {
    void api.listOwners().then((r) => {
      setOwners(r);
      if (r.user) setOwner(r.user);
    }).catch(() => {});
  }, []);

  // Auto-scan the path as the user types (debounced). No manual scan button.
  useEffect(() => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
    if (!path.trim()) {
      setScan(null);
      setScanning(false);
      return;
    }
    setScanning(true);
    scanTimer.current = setTimeout(async () => {
      try {
        const r = await api.scanPath(path.trim());
        setScan({ isGitRepo: r.isGitRepo, branch: r.branch });
      } catch {
        setScan(null);
      } finally {
        setScanning(false);
      }
    }, 400);
    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
    };
  }, [path]);

  /** Open the mobile-friendly folder browser (works on phones, unlike Finder). */
  function handlePickFolder() {
    setPickerOpen(true);
  }

  async function submit() {
    if (!name.trim()) { setError(t('project.nameRequired')); return; }
    if (!path.trim()) { setError(t('project.pathRequired')); return; }
    if (pathExists) { setError(t('project.pathExists')); return; }
    setBusy(true);
    setError(null);
    try {
      if (scan?.isGitRepo) {
        // Existing git repo — register it as-is.
        await createProject({ action: 'open', path: path.trim(), name: name.trim() });
      } else if (noGitChoice === 'no-git') {
        // Plain folder, no git.
        await createProject({ action: 'open', path: path.trim(), name: name.trim() });
      } else if (noGitChoice === 'clone') {
        // Clone a remote repo into the chosen path.
        if (!cloneUrl.trim()) { setError(t('project.cloneUrlRequired')); setBusy(false); return; }
        await createProject({ action: 'clone', cloneUrl: cloneUrl.trim(), destination: path.trim() });
      } else {
        // Create a new GitHub repo (name + owner + visibility) and clone it into the path.
        if (!repoName.trim()) { setError(t('project.repoNameRequired')); setBusy(false); return; }
        await createProject({
          action: 'create',
          newPath: path.trim(),
          name: repoName.trim(),
          github: githubVisibility,
          owner: owner || null,
        });
      }
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ownerOptions = [
    ...(owners.user ? [{ value: owners.user, label: owners.user }] : []),
    ...owners.orgs.map((o) => ({ value: o, label: o })),
  ];

  // Normalize a path for comparison: strip trailing slashes so
  // "/a/b/" and "/a/b" are treated as the same path.
  const normalizePath = (p: string) => p.replace(/\/+$/, '');
  // Whether the chosen path already belongs to an existing project. When true,
  // the Save button is disabled and an inline error is shown — you can't add
  // the same path twice.
  const pathExists = !!path.trim() && projects.some((p) => normalizePath(p.path) === normalizePath(path.trim()));

  return (
    <BottomSheet open onClose={() => navigate('/')} title={t('nav.addProject')}>
      {/* 1. Name — required */}
      <SheetField label={t('project.name')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-project"
          className={sheetInputCls}
        />
      </SheetField>

      {/* 2. Path — required, auto-scanned */}
      <SheetField label={t('project.path')}>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/anibal/Projects/my-repo"
            className={sheetInputCls}
          />
          <Button onClick={handlePickFolder} disabled={busy} variant="outline" size="icon" title="Explore folder">
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
      </SheetField>

      {/* Scan result */}
      <div className="mt-3">
        {pathExists && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{t('project.pathExists')}</span>
          </div>
        )}

        {scanning && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('project.scanning')}
          </div>
        )}

        {!scanning && scan?.isGitRepo && (
          <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs">
            <GitBranch className="h-3.5 w-3.5 text-green-500" />
            <span className="font-medium text-green-600">{t('project.gitRepoDetected')}</span>
            {scan.branch && (
              <span className="ml-auto rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {t('project.activeBranch')}: {scan.branch}
              </span>
            )}
          </div>
        )}

        {!scanning && path.trim() && scan && !scan.isGitRepo && (
          <div className="space-y-2">
            <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {t('project.noGitDetected')}
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs">
                <input type="radio" checked={noGitChoice === 'no-git'} onChange={() => setNoGitChoice('no-git')} />
                {t('project.noGit')}
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="radio" checked={noGitChoice === 'clone'} onChange={() => setNoGitChoice('clone')} />
                {t('project.cloneExisting')}
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input type="radio" checked={noGitChoice === 'create'} onChange={() => setNoGitChoice('create')} />
                {t('project.createNewRepo')}
              </label>
            </div>

            {noGitChoice === 'clone' && (
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/10 p-2">
                <div className="text-xs font-medium text-muted-foreground">{t('project.cloneUrl')}</div>
                <input
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                  className={sheetInputCls}
                />
                <p className="text-[10px] text-muted-foreground">{t('project.cloneHint')}</p>
              </div>
            )}

            {noGitChoice === 'create' && (
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/10 p-2">
                <div className="text-xs font-medium text-muted-foreground">{t('project.repoName')}</div>
                <input
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="my-repo"
                  className={sheetInputCls}
                />
                <div className="text-xs font-medium text-muted-foreground">{t('project.owner')}</div>
                <select
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  className={sheetInputCls}
                >
                  {ownerOptions.length === 0 && <option value="">{t('project.noOwners')}</option>}
                  {ownerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div className="text-xs font-medium text-muted-foreground">{t('project.repoVisibility')}</div>
                <div className="flex gap-2">
                  <Button
                    variant={githubVisibility === 'private' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setGithubVisibility('private')}
                  >
                    {t('project.private')}
                  </Button>
                  <Button
                    variant={githubVisibility === 'public' ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setGithubVisibility('public')}
                  >
                    {t('project.public')}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">{t('project.createHint')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div>}

      <Button onClick={submit} disabled={busy || pathExists} className="mt-4 w-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {busy ? t('project.creating') : t('common.save')}
      </Button>

      {pickerOpen && (
        <FolderPicker
          onClose={() => setPickerOpen(false)}
          onSelect={(picked) => {
            setPath(picked);
            // Auto-fill the project name from the last path segment when empty.
            if (!name.trim()) {
              const base = picked.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? '';
              setName(base);
            }
            setPickerOpen(false);
          }}
        />
      )}
    </BottomSheet>
  );
}
