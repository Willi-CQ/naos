// DESIGN 8.4: idle, holding, done. Pointer and keyboard alike. A quick click or a screen reader activation is not a hold, so it takes
// `onRoute`: the confirm dialog that section 13 asks of every hold.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { createHold } from './hold.ts';

export interface HoldButtonProps {
  ms: number;
  onDone(): void;
  /** Click with no finished hold. Without it such a click does nothing. */
  onRoute?(): void;
  /** Read at the press. False refuses the hold. */
  canStart?(): boolean;
  /** A hold driven from outside, by a key that is not on this button. */
  holding?: boolean;
  /** A change ends a hold in progress: the card it was meant for may be gone. */
  reset?: unknown;
  disabled?: boolean;
  className?: string;
  label?: string;
  keys?: string;
  title?: string;
  children: ReactNode;
}

export function HoldButton({ ms, onDone, onRoute, canStart, holding = false, reset, disabled = false, className, label, keys, title, children }: HoldButtonProps) {
  const [own, setOwn] = useState(false);
  const [done, setDone] = useState(false);
  const skipClick = useRef(false);
  const latest = useRef({ onDone, canStart });
  latest.current = { onDone, canStart };

  const hold = useMemo(() => createHold(ms, () => {
    skipClick.current = true;
    setDone(true);
    latest.current.onDone();
  }, setOwn), [ms]);
  useEffect(() => () => hold.cancel(), [hold, reset]);

  const start = (): void => {
    if (disabled || latest.current.canStart?.() === false) return;
    setDone(false);
    hold.start();
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => { if (e.button === 0) start(); };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== ' ') return;
    e.preventDefault();
    if (!e.repeat) start();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>): void => { if (e.key === ' ') hold.cancel(); };
  const onClick = (): void => {
    if (skipClick.current) { skipClick.current = false; return; }
    if (!disabled) onRoute?.();
  };

  const state = own || holding ? 'holding' : done ? 'done' : 'idle';
  return (
    <button
      type="button" className={`hold ${className ?? ''}`} data-hold={state} aria-disabled={disabled ? 'true' : undefined} aria-label={label} aria-keyshortcuts={keys} title={title}
      onPointerDown={onPointerDown} onPointerUp={() => hold.cancel()} onPointerLeave={() => hold.cancel()} onPointerCancel={() => hold.cancel()}
      onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => hold.cancel()} onClick={onClick}
    >
      <i className="hold-fill" style={{ animationDuration: `${ms}ms` }} aria-hidden="true" />
      <span className="hold-text">{children}</span>
    </button>
  );
}
