// A press that fires only if it lasts. The docket's danger approve, stop, All stop and trust share this, so pointer and keyboard agree.
export interface Hold {
  start(): boolean;
  cancel(): void;
  readonly active: boolean;
}

export interface HoldTimers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const realTimers: HoldTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** `onChange` reports holding on and off. A second `start` during a hold does nothing, so key repeat cannot restart or finish it. */
export function createHold(ms: number, onDone: () => void, onChange?: (holding: boolean) => void, timers: HoldTimers = realTimers): Hold {
  let timer: unknown = null;
  const finish = (): void => {
    timer = null;
    onChange?.(false);
    onDone();
  };
  return {
    start() {
      if (timer !== null) return false;
      timer = timers.set(finish, ms);
      onChange?.(true);
      return true;
    },
    cancel() {
      if (timer === null) return;
      timers.clear(timer);
      timer = null;
      onChange?.(false);
    },
    get active() { return timer !== null; },
  };
}
