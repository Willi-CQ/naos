// A real focus trap for dialogs and sheets. Focus returns through closeOverlay, which remembered where it was.
import { useEffect } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(ref: RefObject<HTMLElement | null>, autofocus = true): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const list = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]'));
    if (autofocus) (root.querySelector<HTMLElement>('[data-autofocus]') ?? list()[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = list();
      const first = all[0];
      const last = all.at(-1);
      if (!first || !last) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ref, autofocus]);
}
