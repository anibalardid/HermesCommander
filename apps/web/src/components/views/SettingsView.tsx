import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Bot, X, ChevronRight, Download, Search, Loader2, RefreshCw, Volume2 } from '@/components/icons';
import { useStore } from '@/store';
import { api } from '@/lib/api';
import { playNotificationSound } from '@/lib/sound';
import { NotificationBell } from '@/components/NotificationBell';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import type { SubagentRecipe, DevPrompt } from '@/lib/types';

/** Editable recipe payload (everything except server-managed fields). */
type RecipeDraft = {
  id?: string;
  name: string;
  title: string;
  description: string;
  system_prompt: string;
  profile: string | null;
  provider: string | null;
  model: string | null;
  is_default: number;
};

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const agents = useStore((s) => s.agentsConfig);
  const refresh = useStore((s) => s.refresh);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [recipes, setRecipes] = useState<SubagentRecipe[] | null>(null);
  const [skills, setSkills] = useState<Array<{ category: string; skills: string[] }>>([]);
  const [mcps, setMcps] = useState<Array<{ name: string; enabled: boolean; command: string }>>([]);
  const [hermesInfoOpen, setHermesInfoOpen] = useState(false);
  const [health, setHealth] = useState<{ apiOnline: boolean; hermesOnline: boolean; profiles: Array<{ name: string; online: boolean }> } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [watchdogNote, setWatchdogNote] = useState<string | null>(null);
  const [watchdogBusy, setWatchdogBusy] = useState(false);
  const [notifySound, setNotifySound] = useState<boolean>(() => {
    const raw = localStorage.getItem('hermes-commander.notify.sound');
    return raw === null ? true : raw !== 'false';
  });
  // Hermes profiles — used to show the orchestrator's inherited provider/model
  // for subagent recipes that inherit from the orchestrator.
  const [hermesProfiles, setHermesProfiles] = useState<Array<{ name: string; model: string; provider: string }>>([]);

  function loadHealth() {
    setHealthLoading(true);
    void api.getHealth()
      .then((h) => setHealth({ apiOnline: h.apiOnline, hermesOnline: h.hermesOnline, profiles: h.profiles }))
      .catch(() => setHealth({ apiOnline: false, hermesOnline: false, profiles: [] }))
      .finally(() => setHealthLoading(false));
  }

  function runWatchdog() {
    if (watchdogBusy) return;
    setWatchdogBusy(true);
    setWatchdogNote(null);
    void api.runWatchdog()
      .then((r) => setWatchdogNote(
        r.tasksRecovered > 0 || r.missionsRecovered > 0
          ? t('settings.watchdogRecovered', { tasks: r.tasksRecovered, missions: r.missionsRecovered })
          : t('settings.watchdogOk')
      ))
      .catch(() => setWatchdogNote(t('settings.watchdogError')))
      .finally(() => setWatchdogBusy(false));
  }

  useEffect(() => {
    void api.listHermesSkills().then((r) => setSkills(r.skills)).catch(() => {});
    void api.listHermesMcp().then((r) => setMcps(r.servers)).catch(() => {});
    void api.listHermesProfiles().then((r) => setHermesProfiles(r.profiles)).catch(() => {});
    loadHealth();
    // Load the notification sound preference from the backend (fall back to
    // localStorage, which the initial state already seeded).
    void api.getNotificationSettings()
      .then((r) => {
        setNotifySound(r.sound);
        localStorage.setItem('hermes-commander.notify.sound', String(r.sound));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setNotifySoundPref(enabled: boolean) {
    setNotifySound(enabled);
    // Persist synchronously to localStorage so the notification bell reads it
    // immediately, and to the backend so it survives across devices.
    localStorage.setItem('hermes-commander.notify.sound', String(enabled));
    void api.updateNotificationSettings({ sound: enabled }).catch(() => {});
  }
  const [editing, setEditing] = useState<SubagentRecipe | 'new' | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryPrefill, setDirectoryPrefill] = useState<{
    name: string; title: string; description: string; system_prompt: string;
  } | null>(null);

  const lang = i18n.language.startsWith('es') ? 'es' : 'en';

  function loadRecipes() {
    void api.listRecipes().then((r) => setRecipes(r.recipes));
  }
  if (recipes === null) loadRecipes();

  function deleteRecipe(id: string) {
    void api.deleteRecipe(id).then(() => setRecipes((r) => r?.filter((x) => x.id !== id) ?? null));
  }

  function saveRecipe(r: RecipeDraft) {
    if (!r.id) return;
    void api.updateRecipe(r.id, r).then(() => {
      setEditing(null);
      void api.listRecipes().then((res) => setRecipes(res.recipes));
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header with back */}
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => navigate('/')} className="rounded-md p-1 hover:bg-accent" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">{t('settings.title')}</h1>
        <button
          onClick={() => setHermesInfoOpen(true)}
          className="ml-auto flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent"
        >
          <Bot className="h-3.5 w-3.5" /> {t('settings.hermesTools')}
        </button>
        <NotificationBell />
      </header>

      <div className="space-y-6 p-4">

        {/* Language */}
        <Card>
          <CardHeader><CardTitle>{t('settings.language')}</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            {['en', 'es'].map((lng) => (
              <button
                key={lng}
                onClick={() => {
                  localStorage.setItem('hermes-commander.lang', lng);
                  void i18n.changeLanguage(lng);
                }}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  lang === lng
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input text-muted-foreground hover:bg-accent'
                }`}
              >
                {lng === 'en' ? 'English' : 'Español'}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Theme */}
        <Card>
          <CardHeader><CardTitle>{t('settings.theme')}</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((th) => (
              <button
                key={th}
                onClick={() => setTheme(th)}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  theme === th
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input text-muted-foreground hover:bg-accent'
                }`}
              >
                {th === 'light' ? t('settings.light') : th === 'dark' ? t('settings.dark') : t('settings.system')}
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader><CardTitle>{t('settings.notifications')}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">{t('settings.notifySound')}</span>
            <div className="flex gap-2">
              {([true, false] as const).map((on) => (
                <button
                  key={String(on)}
                  onClick={() => setNotifySoundPref(on)}
                  aria-pressed={notifySound === on}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    notifySound === on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {on ? t('settings.on') : t('settings.off')}
                </button>
              ))}
              <button
                onClick={() => playNotificationSound()}
                className="flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title={t('settings.testSound')}
              >
                <Volume2 className="h-4 w-4" />
                {t('settings.testSound')}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Healthy: API + Hermes status + re-check frozen tasks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>{t('settings.healthy')}</CardTitle>
            <button
              onClick={loadHealth}
              className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent"
            >
              <RefreshCw className={`icon-anim h-3.5 w-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
              {t('settings.refresh')}
            </button>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* API status */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm font-medium">{t('settings.apiStatus')}</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${health?.apiOnline ? 'text-green-600' : 'text-red-600'}`}>
                <span className={`h-2 w-2 rounded-full ${health?.apiOnline ? 'bg-green-500' : 'bg-red-500'}`} />
                {health?.apiOnline ? t('settings.online') : t('settings.offline')}
              </span>
            </div>
            {/* Hermes status */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <span className="text-sm font-medium">{t('settings.hermesStatus')}</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${health?.hermesOnline ? 'text-green-600' : 'text-red-600'}`}>
                <span className={`h-2 w-2 rounded-full ${health?.hermesOnline ? 'bg-green-500' : 'bg-red-500'}`} />
                {health?.hermesOnline ? t('settings.online') : t('settings.offline')}
              </span>
            </div>
            {/* Profiles */}
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">{t('settings.profiles')}</div>
              {healthLoading && !health ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="icon-anim h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {health?.profiles.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t('settings.noProfiles')}</div>
                  ) : (
                    health?.profiles.map((p) => (
                      <div key={p.name} className="flex items-center justify-between text-xs">
                        <span>{p.name}</span>
                        <span className={`flex items-center gap-1.5 font-medium ${p.online ? 'text-green-600' : 'text-red-600'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${p.online ? 'bg-green-500' : 'bg-red-500'}`} />
                          {p.online ? t('settings.online') : t('settings.offline')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {/* Re-check frozen tasks */}
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">{t('settings.recheckFrozen')}</div>
              <button
                onClick={runWatchdog}
                disabled={watchdogBusy}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
              >
                {watchdogBusy ? <Loader2 className="icon-anim h-4 w-4 animate-spin" /> : <RefreshCw className="icon-anim h-4 w-4" />}
                {t('settings.recheckFrozenBtn')}
              </button>
              {watchdogNote && (
                <div className={`mt-2 text-xs ${watchdogNote.startsWith(t('settings.watchdogError')) ? 'text-red-500' : 'text-green-600'}`}>
                  {watchdogNote}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Subagent recipes (templates) */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>{t('settings.recipes')}</CardTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDirectoryOpen(true)}
                className="flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" /> {t('settings.importDirectory')}
              </button>
              <button
                onClick={() => setEditing('new')}
                className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" /> {t('settings.addRecipe')}
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!recipes && <div className="text-sm text-muted-foreground">{t('common.loading')}</div>}
            {recipes?.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.description}
                  </div>
                  {(() => {
                    // Non-inherited recipes show their own provider/model in
                    // white; inherited ones show the orchestrator's (default
                    // Hermes profile) provider/model in grey — same chip layout.
                    const orch = hermesProfiles.find((p) => p.name === 'default');
                    const provider = r.provider ?? orch?.provider ?? null;
                    const model = r.model ?? orch?.model ?? null;
                    const inherited = !r.provider && !r.model;
                    return (
                      <div className={`mt-0.5 flex items-center gap-1.5 text-[11px] ${inherited ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {provider && <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{provider}</span>}
                        {model && <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{model}</span>}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setEditing(r)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={t('settings.editRecipe')}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteRecipe(r.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('settings.deleteRecipe')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {hermesInfoOpen && (
        <HermesToolsModal
          skills={skills}
          mcps={mcps}
          onClose={() => setHermesInfoOpen(false)}
        />
      )}
      {directoryOpen && (
        <DirectoryModal
          onClose={() => setDirectoryOpen(false)}
          onImport={(bot) => {
            setDirectoryOpen(false);
            setEditing('new');
            // Preload the recipe form from the dev prompt. The prompt goes
            // into the system prompt field; the user then completes the
            // remaining fields and saves.
            setDirectoryPrefill({
              name: bot.id,
              title: bot.name,
              description: '',
              system_prompt: bot.prompt,
            });
          }}
        />
      )}
      {editing && (
        <RecipeModal
          recipe={editing === 'new' ? null : editing}
          existing={recipes ?? []}
          lang={lang}
          prefill={directoryPrefill}
          onClose={() => { setEditing(null); setDirectoryPrefill(null); }}
          onSave={(r) => {
            if (editing === 'new') {
              void api.createRecipe(r).then(() => {
                setEditing(null);
                setDirectoryPrefill(null);
                void api.listRecipes().then((res) => setRecipes(res.recipes));
              });
            } else {
              saveRecipe(r);
            }
          }}
        />
      )}
    </div>
  );
}

function HermesToolsModal({
  skills, mcps, onClose,
}: {
  skills: Array<{ category: string; skills: string[] }>;
  mcps: Array<{ name: string; enabled: boolean; command: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [openCat, setOpenCat] = useState<Record<string, boolean>>({});
  const totalSkills = skills.reduce((n, g) => n + (g.skills.length || 1), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[6vh] sm:items-center sm:pt-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl sm:max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <h2 className="text-lg font-bold">{t('settings.hermesTools')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* MCP servers */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
              {t('settings.mcpServers')}
              <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{mcps.length}</span>
            </div>
            {mcps.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('settings.noMcp')}</p>
            ) : (
              <div className="space-y-1.5">
                {mcps.map((m) => (
                  <div key={m.name} className="flex items-center justify-between rounded-md border border-border/60 p-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{m.name}</div>
                      {m.command && <div className="truncate text-xs text-muted-foreground">{m.command}</div>}
                    </div>
                    <Badge variant={m.enabled ? 'outline' : 'default'}>{m.enabled ? t('settings.enabled') : t('settings.disabled')}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Skills — grouped by category, collapsible */}
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
              {t('settings.skills')}
              <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{totalSkills}</span>
            </div>
            {skills.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('settings.noSkills')}</p>
            ) : (
              <div className="space-y-1.5">
                {skills.map((g) => {
                  const open = openCat[g.category] ?? false;
                  const count = g.skills.length || 1;
                  return (
                    <div key={g.category} className="overflow-hidden rounded-md border border-border/60">
                      <button
                        onClick={() => setOpenCat((p) => ({ ...p, [g.category]: !open }))}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40"
                      >
                        <span className="flex items-center gap-2">
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                          <span className="font-medium">{g.category}</span>
                        </span>
                        <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{count}</span>
                      </button>
                      {open && (
                        <div className="flex flex-wrap gap-1.5 border-t border-border/50 bg-muted/20 px-3 py-2">
                          {g.skills.length === 0 ? (
                            <span className="text-xs text-muted-foreground">{t('settings.noSkills')}</span>
                          ) : (
                            g.skills.map((s) => (
                              <span key={s} className="rounded-md border border-border/60 bg-card px-2 py-1 text-xs">{s}</span>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* How to add / remove / change */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
            <div className="mb-1 font-semibold text-primary">{t('settings.howToAdd')}</div>
            <p className="text-muted-foreground">{t('settings.howToAddBody')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}


function RecipeModal({
  recipe, existing, lang, prefill, onClose, onSave,
}: {
  recipe: SubagentRecipe | null;
  existing: SubagentRecipe[];
  lang: 'en' | 'es';
  prefill: { name: string; title: string; description: string; system_prompt: string } | null;
  onClose: () => void;
  onSave: (r: RecipeDraft) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    title: string;
    description: string;
    system_prompt: string;
    profile: string;
    provider: string;
    model: string;
    is_default: number;
  }>({
    id: recipe?.id,
    name: prefill?.name ?? recipe?.name ?? '',
    title: prefill?.title ?? recipe?.title ?? '',
    description: prefill?.description ?? recipe?.description ?? '',
    system_prompt: prefill?.system_prompt ?? recipe?.system_prompt ?? '',
    profile: recipe?.profile ?? '',
    provider: recipe?.provider ?? '',
    model: recipe?.model ?? '',
    is_default: recipe?.is_default ?? 0,
  });
  // "inherit from orchestrator" — when on, profile/provider/model are null
  // (the subagent uses whatever the parent task has).
  const [inherit, setInherit] = useState(!recipe?.profile && !recipe?.provider && !recipe?.model);
  const [profiles, setProfiles] = useState<Array<{ name: string; provider: string }>>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);

  // Load profiles + providers on mount.
  useEffect(() => {
    void api.listHermesProfiles().then((r) => setProfiles(r.profiles));
    void api.listHermesProviders().then((r) => setProviders(r.providers));
  }, []);

  // When profile changes, adopt its provider. Only reacts to a profile change
  // (not to manual provider edits) so the user can pick a different provider
  // after selecting a profile without it being reset.
  const prevProfile = useRef(form.profile);
  useEffect(() => {
    if (prevProfile.current === form.profile) return;
    prevProfile.current = form.profile;
    const prof = profiles.find((p) => p.name === form.profile);
    if (prof?.provider) setForm((f) => ({ ...f, provider: prof.provider }));
  }, [form.profile, profiles]);

  // When provider changes, fetch models. Keep current model if still present.
  useEffect(() => {
    if (!form.provider) { setModels([]); setForm((f) => ({ ...f, model: '' })); return; }
    void api.listHermesModels(form.provider).then((r) => {
      setModels(r.models);
      setForm((f) => ({ ...f, model: f.model && r.models.includes(f.model) ? f.model : (r.models[0] || '') }));
    });
  }, [form.provider]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[8vh] sm:items-center sm:pt-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl sm:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-bold">
          {recipe ? t('settings.editRecipe') : t('settings.addRecipe')}
        </h2>
        <div className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.recipeName')}</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.recipeTitle')}</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.recipeDescription')}</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring" rows={1} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.startFromPrompt')}</label>
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const src = existing.find((r) => r.id === id);
                if (!src) return;
                // Preload name/slug, title, description and the system prompt from the template.
                setForm((f) => ({
                  ...f,
                  name: f.name || src.name,
                  title: f.title || src.title,
                  description: f.description || src.description,
                  system_prompt: src.system_prompt,
                }));
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t('settings.selectPrompt')}</option>
              {[...existing].sort((a, b) => a.title.localeCompare(b.title)).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.systemPrompt')}</label>
            <textarea value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring" rows={6} />
          </div>

          {/* Agent config: inherit from orchestrator, or pick profile → provider → model */}
          <div className="rounded-md border border-border/60 bg-muted/10 p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={inherit}
                onChange={(e) => {
                  const on = e.target.checked;
                  setInherit(on);
                  if (on) setForm((f) => ({ ...f, profile: '', provider: '', model: '' }));
                }}
              />
              <span className="text-sm">{t('settings.inheritOrchestrator')}</span>
            </label>
            {!inherit && (
              <div className="mt-3 space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.profile')}</label>
                  <select
                    value={form.profile}
                    onChange={(e) => setForm({ ...form, profile: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">{t('settings.selectProfile')}</option>
                    {[...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.provider')}</label>
                    <select
                      value={form.provider}
                      onChange={(e) => setForm({ ...form, provider: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">{t('settings.selectProvider')}</option>
                      {[...providers].sort((a, b) => a.localeCompare(b)).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('settings.model')}</label>
                    <select
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">{t('settings.selectModel')}</option>
                      {[...models].sort((a, b) => a.localeCompare(b)).map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onSave({
              ...form,
              profile: inherit ? null : (form.profile || null),
              provider: inherit ? null : (form.provider || null),
              model: inherit ? null : (form.model || null),
            })}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DirectoryModal({
  onClose, onImport,
}: {
  onClose: () => void;
  onImport: (bot: DevPrompt) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [prompts, setPrompts] = useState<DevPrompt[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search against the backend (which caches the library for 1h).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(false);
      void api.searchPrompts(q)
        .then((r) => { setPrompts(r.prompts); setTotal(r.total); })
        .catch(() => { setPrompts([]); setTotal(0); setError(true); })
        .finally(() => setLoading(false));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[6vh]" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div>
            <h2 className="text-lg font-bold">{t('settings.directoryTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('settings.directorySubtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border/60 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('settings.directorySearch')}
              className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('settings.directoryLoading')}
            </div>
          )}
          {!loading && error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {t('settings.directoryError')}
            </div>
          )}
          {!loading && !error && prompts !== null && prompts.length === 0 && (
            <div className="text-sm text-muted-foreground">{t('settings.directoryNoResults')}</div>
          )}
          {!loading && !error && prompts?.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge variant="outline">{p.type}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.prompt}</p>
              </div>
              <button
                onClick={() => onImport(p)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
              >
                <Download className="h-3.5 w-3.5" /> {t('settings.directoryImport')}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/60 px-5 py-3">
          <span className="text-xs text-muted-foreground">{total} prompts</span>
          <span className="text-xs text-muted-foreground">{t('settings.directoryImportHint')}</span>
        </div>
      </div>
    </div>
  );
}
