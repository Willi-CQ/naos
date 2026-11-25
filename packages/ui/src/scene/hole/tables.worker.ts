// The two heavy tables, off the main thread. Together they take a third of a second, and a spinner on the rails is not worth that.
import { buildOrbitTables } from './geodesic.ts';
import { bakeStreaks } from './streaks.ts';

const orbit = buildOrbitTables();
const streak = bakeStreaks();
postMessage({ u: orbit.u, length: orbit.length, streak }, { transfer: [orbit.u.buffer, orbit.length.buffer, streak.buffer] });
