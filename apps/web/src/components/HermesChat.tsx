import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useStore } from '@/store';
import type { HermesSession } from '@/lib/types';
import { History, Loader2, MessageCircle, Minus, Send, Trash2 } from '@/components/icons';

type Msg = { role: 'user' | 'assistant'; text: string; session_id?: string };

/**
 * Floating Hermes chat (inspired by the Hermes dashboard). A FAB in the
 * bottom-right opens a window where you pick which Hermes profile to talk to,
 * optionally resume one of that profile's previous sessions, then send
 * one-shot messages. Each message is a fresh `hermes chat -q` call against the
 * selected profile (and session when one is chosen).
 *
 * The header button now MINIMIZES the window back to the FAB (instead of a
 * hard close); the window is a taller, fixed-height panel; and a session
 * picker lists the selected profile's recent conversations to resume.
 */
export function HermesChat() {
  const { t } = useTranslation();
  const open = useStore((s) => s.chatOpen);
  const setOpen = useStore((s) => s.setChatOpen);
  const [profiles, setProfiles] = useState<Array<{ name: string; model: string; provider: string }>>([]);
  const [profile, setProfile] = useState('');
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const saved = localStorage.getItem('hermes-commander.chat');
      return saved ? (JSON.parse(saved) as Msg[]) : [];
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Persist the conversation across reloads/navigation.
  useEffect(() => {
    try {
      localStorage.setItem('hermes-commander.chat', JSON.stringify(msgs));
    } catch { /* ignore quota errors */ }
  }, [msgs]);

  useEffect(() => {
    if (!open) return;
    void api.listHermesProfiles().then((r) => {
      setProfiles(r.profiles);
      if (r.profiles.length > 0) {
        const saved = localStorage.getItem('hermes-commander.chat.profile');
        const target = saved && r.profiles.some((p) => p.name === saved) ? saved : r.profiles[0].name;
        setProfile((cur) => cur || target);
        if (!localStorage.getItem('hermes-commander.chat.profile')) localStorage.setItem('hermes-commander.chat.profile', target);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load the selected profile's recent sessions so the user can resume one.
  useEffect(() => {
    if (!open || !profile) return;
    setSessionId('');
    void api.listHermesSessions(profile).then((r) => setSessions(r.sessions));
  }, [open, profile]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    const prof = profiles.find((p) => p.name === profile);
    try {
      const res = await api.chatHermes(text, {
        profile: prof?.name,
        model: prof?.model,
        provider: prof?.provider,
        session_id: sessionId || undefined,
      });
      setMsgs((m) => [...m, { role: 'assistant', text: res.reply, session_id: res.session_id }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[min(82vh,640px)] w-[min(94vw,460px)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="h-4 w-4 text-primary" />
              {t('chat.title')}
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={profile}
                onChange={(e) => { setProfile(e.target.value); localStorage.setItem('hermes-commander.chat.profile', e.target.value); }}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none"
                title={t('chat.profile')}
              >
                {[...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              {/* Minimize: collapse the window back to the FAB (keeps conversation). */}
              <button onClick={() => setOpen(false)} title={t('chat.minimize')} aria-label={t('chat.minimize')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
                <Minus className="h-4 w-4" />
              </button>
              <button onClick={() => { setMsgs([]); localStorage.removeItem('hermes-commander.chat'); }} aria-label={t('chat.clear')} title={t('chat.clear')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Session picker (resume a previous conversation of the profile) */}
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none"
              title={t('chat.session')}
            >
              <option value="">{t('chat.newSession')}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.preview || s.id}
                </option>
              ))}
            </select>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {msgs.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">{t('chat.empty')}</p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted/60'}`}>
                {m.text}
                {m.session_id && <div className="mt-1 text-[10px] text-muted-foreground/60">#{m.session_id}</div>}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('chat.thinking')}
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 border-t p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
              placeholder={t('chat.placeholder')}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || busy}
              aria-label={t('chat.send')}
              className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
