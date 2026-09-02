import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { Button } from '@/components/ui';
import { BottomSheet, SheetField, sheetInputCls } from '@/components/BottomSheet';

/**
 * Mission creation is now minimal: a mission is just a name + description
 * (a container). The orchestrator config (driver profile/model/provider, git
 * strategy, subagents) lives on each PARENT task inside the mission's board.
 */
export function NewMissionView() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const createMission = useStore((s) => s.createMission);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await createMission({
        projectId,
        name,
        objective: description,
        gitStrategy: 'none',
        driver: { type: 'hermes', profile: null, model: 'deepseek-v4-flash:cloud', provider: null },
        usesKanban: true,
      });
      navigate(`/project/${projectId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open onClose={() => navigate(`/project/${projectId}`)} title={t('newMission.title')}>
      <div className="space-y-4">
        <SheetField label={t('newMission.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} className={sheetInputCls} placeholder="Fix auth flow" />
        </SheetField>

        <SheetField label={t('newMission.objective')}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={sheetInputCls} rows={4} placeholder="Refactor the auth flow to use OAuth2..." />
        </SheetField>

        <p className="text-xs text-muted-foreground">
          {t('newMission.hint')}
        </p>

        <Button onClick={submit} disabled={busy || !name.trim()} className="w-full">
          {t('newMission.create')}
        </Button>
      </div>
    </BottomSheet>
  );
}
