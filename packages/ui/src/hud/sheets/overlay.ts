// Two habits of the overlay host that every sheet of the Hand needs. The host keeps an instance through its 180 ms fade, and that shows
// twice: a reopen inside the fade gets the old instance, and a closed field keeps focus until the fade ends.
import { useRef } from 'react';
import { closeOverlay, useView } from '../../store/store.ts';

/** Closes an overlay whose work is done, so the next key cannot land in a field on its way out. */
export function finishOverlay(id: string): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  closeOverlay(id);
}

/** Bumps on every opening. As a `key` it gives a reopen a fresh instance, so focus and state start over. */
export function useOpening(id: string): number {
  const open = useView((v) => v.overlays.some((o) => o.id === id));
  const count = useRef(0);
  const was = useRef(open);
  if (open && !was.current) count.current += 1;
  was.current = open;
  return count.current;
}
