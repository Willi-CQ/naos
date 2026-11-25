// What a screen reader gets instead of the scene, section 13. The canvas is aria-hidden, so this list carries every craft.
import { useEffect, useRef, useState } from 'react';
import { useNaos } from '../store/store.ts';

const MIRROR_MS = 1000;

export function SceneMirror() {
  const [lines, setLines] = useState<readonly string[]>([]);
  const [count, setCount] = useState(0);
  // The Veil cannot wait for the next second: a name must leave the DOM when the key lands.
  const veil = useNaos((s) => s.view.settings.veil);
  useEffect(() => {
    const update = () => {
      const { model } = useNaos.getState();
      setLines(model.mirror);
      setCount(model.craftCount);
    };
    update();
    const timer = setInterval(update, MIRROR_MS);
    return () => clearInterval(timer);
  }, [veil]);
  return (
    <section className="sr-only" aria-label="Scene">
      <p>{count} craft</p>
      <ul>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </section>
  );
}

/** Two live regions. Assertive holds only new answerable decisions, everything else waits its turn in the polite one. */
export function Announcer() {
  const polite = useNaos((s) => s.announce.polite);
  const assertive = useNaos((s) => s.announce.assertive);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive">{assertive}</div>
    </>
  );
}

export function useTitle(): void {
  const title = useNaos((s) => s.model.title);
  const badge = useNaos((s) => s.model.badge > 0);
  const base = useRef<string | null>(null);
  useEffect(() => { document.title = title; }, [title]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    base.current ??= link.href;
    link.href = badge ? favicon(true) : favicon(false);
  }, [badge]);
}

/** The O of the wordmark, with a `nad` dot while something can be answered here. */
function favicon(dot: boolean): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#060504"/><circle cx="16" cy="16" r="11" fill="none" stroke="#F4ECDF" stroke-width="1.5"/><circle cx="21.5" cy="6.5" r="2.5" fill="#F4ECDF"/>${dot ? '<circle cx="23" cy="23" r="7" fill="#FD9D4E"/>' : ''}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
