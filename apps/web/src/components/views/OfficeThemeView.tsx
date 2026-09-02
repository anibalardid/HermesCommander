import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2 } from '@/components/icons';
import { useStore } from '@/store';
import { NotificationBell } from '@/components/NotificationBell';
import { OfficeCanvas } from '@/components/office/OfficeCanvas';
import type { ThemeId } from '@/components/office/engine/world';

export function OfficeThemeView({ theme, title }: { theme: ThemeId; title: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const missions = useStore((s) => s.missions);

  const byState = (s: string) => missions.filter((m) => m.state === s).length;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => navigate('/')} className="rounded-md p-1 hover:bg-accent" aria-label={t('common.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Building2 className="icon-anim h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold leading-tight">{title}</h1>
            <p className="text-xs text-muted-foreground">{t('office.subtitle')}</p>
          </div>
        </div>
        <div className="ml-auto"><NotificationBell /></div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 border-b px-4 py-3">
        <Stat label="running" value={byState('running')} color="text-green-600" />
        <Stat label="paused" value={byState('paused')} color="text-yellow-600" />
        <Stat label="failed" value={byState('failed')} color="text-red-600" />
        <Stat label="done" value={byState('done')} color="text-lime-600" />
      </div>

      {/* The office map */}
      <div className="flex-1 overflow-y-auto p-4">
        <OfficeCanvas missions={missions} theme={theme} onSelect={(id) => navigate(`/mission/${id}`)} />
        {missions.length === 0 && (
          <div className="mt-6 text-center text-sm text-muted-foreground">
            {t('office.noProjects')}
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
