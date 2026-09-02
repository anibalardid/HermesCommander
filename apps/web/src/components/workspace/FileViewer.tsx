import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Highlight, themes } from 'prism-react-renderer';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Copy, Check, Pencil, Save, Eye, Code } from '@/components/icons';
import { cn } from '@/lib/utils';

type FileContent = { path: string; text: string; truncated: boolean };

/** Map a file extension to a prism language id. */
export function extToLang(path: string): string {
  const m = path.match(/\.([a-zA-Z0-9]+)$/);
  const ext = (m ? m[1] : '').toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript',
    json: 'json', jsonc: 'json', html: 'markup', htm: 'markup', xml: 'markup',
    svg: 'markup', css: 'css', scss: 'scss', md: 'markdown',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c',
    cpp: 'cpp', h: 'c', hpp: 'cpp', sh: 'bash', bash: 'bash', zsh: 'bash',
    yml: 'yaml', yaml: 'yaml', sql: 'sql', graphql: 'graphql', toml: 'toml',
    diff: 'diff', dockerfile: 'docker', ini: 'ini',
  };
  // dockerfile / makefile detection by name
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'docker';
  if (name === 'makefile') return 'makefile';
  return map[ext] ?? 'plain';
}

/** Whether a file should offer a rendered preview (markdown). */
function isMarkdown(path: string): boolean {
  return /\.md(x)?$/i.test(path);
}

export function FileViewer({
  content,
  adapter,
  onClose,
}: {
  content: FileContent;
  adapter: { write?: (path: string, c: string) => Promise<{ ok: boolean }> };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const lang = useMemo(() => extToLang(content.path), [content.path]);
  const [mode, setMode] = useState<'view' | 'preview'>(isMarkdown(content.path) ? 'preview' : 'view');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content.text);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset draft when a new file opens.
  useEffect(() => {
    setDraft(content.text);
    setEditing(false);
    setSaved(false);
    setCopied(false);
    setError(null);
    setMode(isMarkdown(content.path) ? 'preview' : 'view');
  }, [content.path, content.text]);

  const canEdit = !!adapter.write && !content.truncated;
  const hasPreview = isMarkdown(content.path);

  async function doSave() {
    if (!adapter.write || saving) return;
    setSaving(true);
    setError(null);
    try {
      await adapter.write(content.path, draft);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(editing ? draft : content.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span className="min-w-0 truncate font-mono text-xs">{content.path}</span>
        <div className="flex shrink-0 items-center gap-1">
          {/* Markdown: view / preview toggle */}
          {hasPreview && !editing && (
            <div className="mr-1 flex items-center rounded-md border border-border/60 bg-muted/40 p-0.5">
              <button
                onClick={() => setMode('view')}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${mode === 'view' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title={t('workspace.sourceView')}
              >
                <Code className="h-3 w-3" /> {t('workspace.source')}
              </button>
              <button
                onClick={() => setMode('preview')}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${mode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title={t('workspace.previewView')}
              >
                <Eye className="h-3 w-3" /> {t('workspace.preview')}
              </button>
            </div>
          )}

          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} className="rounded-md p-1 text-muted-foreground hover:bg-accent" title={t('workspace.edit')}>
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canEdit && editing && (
            <>
              <button onClick={() => void doSave()} className="rounded-md p-1 text-green-500 hover:bg-accent" title={t('workspace.save')} disabled={saving}>
                {saving ? <Check className="h-4 w-4 animate-pulse" /> : <Save className="h-4 w-4" />}
              </button>
              <button onClick={() => { setDraft(content.text); setEditing(false); }} className="rounded-md p-1 text-muted-foreground hover:bg-accent" title={t('workspace.cancel')}>
                <X className="h-4 w-4" />
              </button>
            </>
          )}
          <button onClick={() => void copyContent()} className="rounded-md p-1 text-muted-foreground hover:bg-accent" title={t('workspace.copy')}>
            {copied || saved ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label={t('workspace.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {content.truncated && (
        <div className="border-b border-yellow-400/30 bg-yellow-400/10 px-3 py-1 text-[10px] text-yellow-500">{t('workspace.tooLarge')}</div>
      )}
      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1 text-[11px] text-destructive">{error}</div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto bg-black/95">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-full w-full resize-none bg-black/95 p-3 font-mono text-[12px] leading-relaxed text-green-400 focus:outline-none"
            spellCheck={false}
          />
        ) : mode === 'preview' && hasPreview ? (
          <div className="prose prose-sm max-w-none p-4 text-sm dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content.text}</ReactMarkdown>
          </div>
        ) : (
          <Highlight theme={themes.nightOwl} code={content.text} language={lang}>
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre className={cn('min-h-full overflow-auto p-3 font-mono text-[11px] leading-relaxed', className)} style={style}>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })} className="table-row">
                    <span className="table-cell select-none pr-4 text-right opacity-40">{i + 1}</span>
                    <span className="table-cell whitespace-pre">
                      {line.map((token, key) => <span key={key} {...getTokenProps({ token })} />)}
                    </span>
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        )}
      </div>
    </div>
  );
}
