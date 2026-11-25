import type { Plane } from '../context.ts';
import { Observer } from './observer.ts';

export const createObserver = (): Plane => new Observer();
