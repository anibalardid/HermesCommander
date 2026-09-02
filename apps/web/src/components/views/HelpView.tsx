import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, HelpCircle, FolderGit2, Target, Bot, KanbanSquare } from '@/components/icons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';

export function HelpView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto">
      {/* Header with back */}
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => navigate('/')} className="rounded-md p-1 hover:bg-accent" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">{t('help.title')}</h1>
        <div className="ml-auto"><NotificationBell /></div>
      </header>

      <div className="space-y-6 p-4">
        {/* Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4" /> {t('help.overview')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('help.overviewText')}</p>
          </CardContent>
        </Card>

        {/* Architecture diagram */}
        <Card>
          <CardHeader>
            <CardTitle>Architecture</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center gap-2 text-xs">
              <div className="rounded-lg border bg-primary px-4 py-2 text-primary-foreground">You (phone/tablet/desktop)</div>
              <div className="text-muted-foreground">↓ Tailscale</div>
              <div className="rounded-lg border bg-primary px-4 py-2 text-primary-foreground">Hermes Commander daemon (Mac/miniPC/Linux)</div>
              <div className="text-muted-foreground">↓ spawns</div>
              <div className="flex gap-2">
                <div className="rounded-lg border px-3 py-2">Hermes (orchestrator)</div>
                <div className="rounded-lg border px-3 py-2">Codex</div>
                <div className="rounded-lg border px-3 py-2">OpenCode</div>
                <div className="rounded-lg border px-3 py-2">Claude</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sections */}
        <div className="grid gap-3 sm:grid-cols-2">
          <HelpCard icon={<FolderGit2 className="h-4 w-4" />} title={t('help.projects')} text={t('help.projectsText')} />
          <HelpCard icon={<Target className="h-4 w-4" />} title={t('help.missions')} text={t('help.missionsText')} />
          <HelpCard icon={<Bot className="h-4 w-4" />} title={t('help.agents')} text={t('help.agentsText')} />
          <HelpCard icon={<KanbanSquare className="h-4 w-4" />} title={t('help.kanban')} text={t('help.kanbanText')} />
        </div>
      </div>
    </div>
  );
}

function HelpCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">{icon} {title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
