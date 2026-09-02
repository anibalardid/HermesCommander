import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from '@/components/icons';
import { LeftSidebar } from './LeftSidebar';
import { useStore } from '@/store';

/**
 * Mobile-only navigation drawer. The hamburger trigger lives in the page
 * header (OfficeView) and toggles `mobileNavOpen` in the store; this component
 * renders the left drawer reusing the SAME <LeftSidebar /> as desktop/tablet
 * (no duplicated menu). Only rendered below the `md` breakpoint (<768px).
 *
 * - Opens on hamburger tap, closes on backdrop tap, X button, nav selection, or Escape.
 * - Locks body scroll while open and restores it on close.
 * - Basic a11y: aria-expanded, aria-label, aria-controls, role="dialog".
 */
export function MobileNav() {
  const { t } = useTranslation();
  const open = useStore((s) => s.mobileNavOpen);
  const setOpen = useStore((s) => s.setMobileNavOpen);

  const close = () => setOpen(false);

  // Lock body scroll while the drawer is open; restore on close/unmount.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <>
      {/* Drawer */}
      {open && (
        <div
          id="mobile-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('nav.menu')}
          className="fixed inset-0 z-50 md:hidden"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 animate-in fade-in bg-black/50"
            onClick={close}
            aria-hidden="true"
          />
          {/* Panel — reuses the desktop/tablet sidebar verbatim */}
          <div className="absolute inset-y-0 left-0 h-full w-[85%] animate-in slide-in-from-left bg-background shadow-xl">
            <button
              type="button"
              onClick={close}
              aria-label={t('common.close')}
              className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            <LeftSidebar onNavigate={close} />
          </div>
        </div>
      )}
    </>
  );
}
