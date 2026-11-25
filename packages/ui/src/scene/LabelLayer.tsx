// LabelLayer, DESIGN 8.6: 30 pooled DOM nodes over the canvas, under the rails. The text comes from the model, where the Veil acts,
// and a text write happens only when it differs, so a moving world costs one transform per label.
import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { LABEL_CAP } from '../core/labels.ts';
import { openOverlay, select, selectWorld } from '../store/store.ts';
import type { LabelSink, SceneController } from './controller.ts';

const OFFSET = { start: '0', middle: '-50%', end: '-100%' } as const;
/** The Plate's y is a text baseline. Measured on B612 in a 16 px line, that lies 14 px down from the top of the box. */
const BASELINE = 14;

export function LabelLayer({ controller }: { controller: SceneController }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nodes = Array.from(root.current!.children) as HTMLElement[];
    const seen = nodes.map(() => ({ key: '', text: '', glyph: '', x: Number.NaN, y: Number.NaN, anchor: '', on: false, behind: false }));
    for (const node of nodes) node.style.transition = 'opacity 180ms linear';
    const sink: LabelSink = (rows, free, shift) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        const row = rows[i];
        const was = seen[i]!;
        if (!row) {
          if (was.on) { node.dataset.on = 'false'; was.on = false; }
          continue;
        }
        if (was.key !== row.key) {
          was.key = row.key;
          node.dataset.key = row.key;
          node.dataset.kind = row.kind;
          node.dataset.world = row.worldId ?? '';
        }
        if (node.dataset.tone !== row.tone) node.dataset.tone = row.tone;
        if (was.glyph !== row.glyph) { was.glyph = row.glyph; (node.firstChild as HTMLElement).textContent = row.glyph; }
        if (was.text !== row.text) { was.text = row.text; (node.lastChild as HTMLElement).textContent = row.text; }
        const d = shift(row);
        if (d.hidden) {
          if (was.on) { node.dataset.on = 'false'; was.on = false; }
          continue;
        }
        const x = Math.round(row.x + d.x + free.w / 2);
        const y = Math.round(row.y + d.y + free.h / 2 - BASELINE);
        // Compared as numbers first: this runs every frame for 30 labels, and a string each time is what it would allocate.
        if (x !== was.x || y !== was.y || row.anchor !== was.anchor) {
          was.x = x;
          was.y = y;
          was.anchor = row.anchor;
          node.style.transform = `translate(${x}px, ${y}px) translateX(${OFFSET[row.anchor]})`;
        }
        if (!was.on) { node.dataset.on = 'true'; was.on = true; }
        // Hidden behind a body: it fades, and it stops catching the pointer.
        if (d.behind !== was.behind) {
          was.behind = d.behind;
          node.style.opacity = d.behind ? '0' : '';
          node.style.pointerEvents = d.behind ? 'none' : '';
          node.dataset.behind = String(d.behind);
        }
      }
    };
    controller.bindLabels(sink);
    return () => controller.bindLabels(null);
  }, [controller]);

  const click = (e: MouseEvent<HTMLDivElement>) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('.lbl');
    if (!node) return;
    if (node.dataset.kind === 'craft') select(node.dataset.key ?? null);
    else selectWorld(node.dataset.key ?? null);
  };

  return (
    <div ref={root} className="labels" aria-hidden="true" onClick={click} onDoubleClick={(e) => { const node = (e.target as HTMLElement).closest<HTMLElement>('.lbl'); if (node?.dataset.kind === 'world' && node.dataset.key) openOverlay('project', node.dataset.key); }}>
      {Array.from({ length: LABEL_CAP }, (_, i) => <div key={i} className="lbl" data-on="false"><span className="greek" /><span className="txt" /></div>)}
    </div>
  );
}
