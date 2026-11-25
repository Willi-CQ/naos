// Builds the family off the main thread. The capital alone takes a tenth of a second, and a frame that waits for a ship is a frame the
// operator waits for. A craft is a mark until its part lands here, so nothing depends on how long this takes.
import { part, PART_IDS } from './parts.ts';

for (const id of PART_IDS) {
  const p = part(id);
  const buffers = [p.near, p.far, p.speck].flatMap((m) => [m.position.buffer, m.normal.buffer, m.uv.buffer, m.meta.buffer, m.edge.buffer, m.index.buffer]);
  postMessage(p, { transfer: [...buffers, p.field.data.buffer] as Transferable[] });
}
postMessage('done');
