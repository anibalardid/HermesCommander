import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Check, ChevronDown } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * SearchableSelect — a combobox with type-to-filter and alphabetical ordering.
 *
 * Replaces native <select> for long option lists (Hermes providers/models).
 * Options are sorted ascending by label by default; pass `sort={false}` to
 * preserve the given order, or prefix labels with numbers to force a custom
 * order (e.g. "1. Backend", "2. Frontend").
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  sort = true,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  sort?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    const opts = [...options];
    if (sort) opts.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return opts;
  }, [options, sort]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((o) => o.label.toLowerCase().includes(q));
  }, [sorted, query]);

  const selected = options.find((o) => o.value === value);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset highlight when the filtered list changes.
  useEffect(() => setHighlight(0), [filtered.length, open]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function select(o: { value: string; label: string }) {
    onChange(o.value);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlight]) select(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50',
          open && 'ring-1 ring-ring'
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              className="w-full bg-transparent py-2 text-sm focus:outline-none"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
            )}
            {filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => select(o)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                  i === highlight ? 'bg-accent text-accent-foreground' : 'text-foreground'
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
