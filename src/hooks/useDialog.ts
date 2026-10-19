import { useEffect, useRef } from 'react';

/**
 * Keyboard behaviour for modal dialogs and bottom sheets:
 *  - Escape closes the top-most open dialog (stacked dialogs close one at a time).
 *  - Tab cycles focus inside the top-most dialog instead of leaving it behind.
 *  - Focus returns to the element that opened the dialog when it closes.
 *
 * A dialog is any element with `role="dialog"` and `aria-modal="true"`.
 * Pass `active=false` for a component that stays mounted while closed.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const stack: symbol[] = [];

function topDialog(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return all.length ? all[all.length - 1] : null;
}

export function useDialog(onClose: () => void, active = true): void {
  // Keep the latest callback in a ref so inline arrows do not re-run the effect (which would move focus).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const token = Symbol('dialog');
    stack.push(token);
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return; // not the top-most dialog
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = topDialog();
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !dialog.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !dialog.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [active]);
}
