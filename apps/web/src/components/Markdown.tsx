import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders GitHub-style markdown (and inline HTML) safely. Used for PR
 * descriptions and comments, which often contain markdown/HTML formatting.
 * GitHub comments are trusted content from the user's own repos, so we render
 * them as markdown (react-markdown escapes raw HTML by default, which is the
 * safe behavior).
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-body text-sm leading-relaxed text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
