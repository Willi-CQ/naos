// The Channel, sections 4.7 and 8.3. Structure by default. Text comes only from an explicit `W` for this one craft.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { channelRowVM } from '../store/model.ts';
import { slotOf } from '../store/registry.ts';
import { COPY, SECTION } from '../store/strings.ts';
import { pinChannel, toggleText, useModel, useNaos, useShell, useView } from '../store/store.ts';
import { Designator } from './marks.tsx';

/** A sealed text row: one px per 4 chars, so length reads and no text does. */
const barPx = (chars: number): number => Math.max(6, Math.min(240, chars / 4));

export function Channel({ grow }: { grow: boolean }) {
  const channel = useNaos(useShallow((s) => s.channel));
  const craft = useModel((m) => (channel.nodeId ? m.crafts[channel.nodeId] : undefined));
  const crafts = useModel((m) => m.crafts);
  const veil = useView((v) => v.settings.veil);
  const level = useView((v) => v.level);
  const instrument = useShell((s) => s.instrument);
  const now = useModel((m) => m.now);
  const wide = level === 'craft' && !instrument;

  const rows = useMemo(() => {
    const opts = { veil, wide, now, openTools: craft?.activeTools ?? [], crafts };
    const limit = wide ? 400 : 40;
    return channel.rows.slice(-limit).map((row) => channelRowVM(row, opts));
  }, [channel.rows, veil, wide, now, craft?.activeTools, crafts]);

  const textOf = useMemo(() => new Map(channel.text.map((t) => [t.messageId, t.text])), [channel.text]);

  return (
    <section className={`sec${grow ? ' grow' : ''}`} aria-label={SECTION.channel}>
      <div className="sec-head t-label">
        <h2 className="t-label" style={{ margin: 0 }}>{SECTION.channel}{wide ? <span className="t-num-s c-slag" style={{ textTransform: 'none', marginLeft: 8 }}>{channel.textOn ? 'text' : 'structure'}</span> : null}</h2>
        {craft ? (
          <span className="chan-actions t-body" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {wide && craft.capabilities.includes('text') ? <button type="button" className="t-micro" onClick={() => void toggleText()}>{channel.textOn ? COPY.textOpen : COPY.textSealed}</button> : null}
            {channel.textOn ? <button type="button" className="t-micro" aria-pressed={channel.pinned} onClick={pinChannel}>{channel.pinned ? 'pinned' : 'pin'}</button> : null}
            <span className="t-num" style={{ color: 'var(--bone)' }}>{craft.worldName} <Designator glyph={craft.glyph} letter={craft.letter} /></span>
          </span>
        ) : null}
      </div>
      {craft === undefined ? <p className="chan-note t-body" style={{ margin: 0 }}>{COPY.channelEmpty}</p> : null}
      {craft && rows.length === 0 && !channel.loading ? <p className="chan-note t-body" style={{ margin: 0 }}>{craft.client !== 'claude-code' && !craft.capabilities.includes('text') ? 'Activity and model observed. Transcript view is not available for this client.' : COPY.channelNone}</p> : null}
      <div className="chan-list" role="log" aria-label={SECTION.channel}>
        {rows.map((row) => {
          const text = row.messageId ? textOf.get(row.messageId) : undefined;
          const sealed = wide && row.sealedChars !== null && text === undefined;
          return (
            <div key={row.key} className="chan-row" data-error={row.error}>
              <span className="time">{row.time}</span>
              <span className="lbl">{row.label}</span>
              <span className="bod">
                {sealed ? <span className="chan-bar" style={{ width: barPx(row.sealedChars ?? 0) }} aria-hidden="true" /> : null}
                {sealed ? null : row.body}{!wide && row.extra ? ` ${row.extra}` : ''}
              </span>
              {wide ? <span className="ext">{sealed ? row.body : row.extra}</span> : null}
              {text !== undefined ? <div className="chan-text">{text}</div> : null}
            </div>
          );
        })}
        {channel.textOn && channel.liveText ? <div className="chan-text">{channel.liveText}</div> : null}
        {channel.textFailed ? <p className="chan-note t-body" style={{ margin: 0 }}>{COPY.textUnavailable}</p> : null}
        {craft?.state === 'generating' ? <p className="chan-note t-num-s" style={{ margin: 0, textAlign: 'center' }}>generating</p> : null}
      </div>
    </section>
  );
}

/** Foot of the wide Channel: the Hand's follow-up box, or who owns this craft. */
export function ChannelFoot() {
  const nodeId = useNaos((s) => s.channel.nodeId);
  const craft = useModel((m) => (nodeId ? m.crafts[nodeId] : undefined));
  const Slot = slotOf('followUp');
  if (!craft) return null;
  if (craft.owned) return Slot ? <Slot /> : null;
  return <div className="readonly t-body"><b>{COPY.readOnly}</b>{craft.linkOwner}, no input, no stop</div>;
}
