// DESIGN 9.2: bright flashes stay below three per second, so landings stagger. Pure, with the clock passed in.

/** Any one second holds at most this many. */
export const FLASHES_PER_SECOND = 2;
const WINDOW_MS = 1_000;

export class FlashGate {
  private readonly at: number[] = [];

  /** The soonest a flash asked for at `now` may fire. It is booked, so the next one queues behind it. */
  book(now: number): number {
    let t = now;
    const { at } = this;
    if (at.length >= FLASHES_PER_SECOND) t = Math.max(t, at[at.length - FLASHES_PER_SECOND]! + WINDOW_MS + 1);
    at.push(t);
    if (at.length > FLASHES_PER_SECOND * 2) at.shift();
    return t;
  }

  /** For an effect that means nothing late, such as a spark. False leaves the gate as it was. */
  tryNow(now: number): boolean {
    const { at } = this;
    if (at.length >= FLASHES_PER_SECOND && now <= at[at.length - FLASHES_PER_SECOND]! + WINDOW_MS) return false;
    at.push(now);
    if (at.length > FLASHES_PER_SECOND * 2) at.shift();
    return true;
  }

  clear(): void { this.at.length = 0; }
}
