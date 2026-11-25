import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { Sensor, isApiRequestBody, parseLine } from '../../src/observer/parse.ts';
import { MAX_LINE_BYTES, drain, newCursor, readHeadTail, scanLines } from '../../src/observer/tail.ts';

const dir = mkdtempSync(path.join(os.tmpdir(), 'naos-tail-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const file = (): string => path.join(dir, `f${(n += 1)}.jsonl`);

const collect = (): { lines: string[]; offsets: number[]; fn: (l: Buffer, o: number) => void } => {
  const lines: string[] = [];
  const offsets: number[] = [];
  return { lines, offsets, fn: (l, o) => { lines.push(l.toString()); offsets.push(o); } };
};

describe('scanLines', () => {
  it('keeps a torn tail as carry and joins it across chunks, with true byte offsets', () => {
    const c = newCursor('x');
    const got = collect();
    const text = Buffer.from('{"a":1}\n{"b":22}\n');
    scanLines(c, text.subarray(0, 12), 0, got.fn);
    assert.deepEqual(got.lines, ['{"a":1}']);
    assert.ok(c.carry);
    scanLines(c, text.subarray(12), 12, got.fn);
    assert.deepEqual(got.lines, ['{"a":1}', '{"b":22}']);
    assert.deepEqual(got.offsets, [0, 8]);
    assert.equal(c.carry, null);
  });

  it('survives a split at every byte of a multi-byte line', () => {
    const text = Buffer.from('{"a":"é€😀"}\n{"b":"x"}\n');
    for (let cut = 1; cut < text.length; cut += 1) {
      const c = newCursor('x');
      const got = collect();
      scanLines(c, text.subarray(0, cut), 0, got.fn);
      scanLines(c, text.subarray(cut), cut, got.fn);
      assert.deepEqual(got.lines, ['{"a":"é€😀"}', '{"b":"x"}'], `cut at ${cut}`);
    }
  });

  it('skips the first partial line after landing inside one', () => {
    const c = newCursor('x', 5, true);
    const got = collect();
    scanLines(c, Buffer.from('tail of a line\n{"b":1}\n'), 5, got.fn);
    assert.deepEqual(got.lines, ['{"b":1}']);
    assert.deepEqual(got.offsets, [20]);
  });

  it('drops an oversized line and resynchronises on the next newline', () => {
    const c = newCursor('x');
    const got = collect();
    const big = Buffer.alloc(MAX_LINE_BYTES + 10, 0x61);
    assert.equal(scanLines(c, big, 0, got.fn), 1);
    assert.equal(c.carry, null);
    scanLines(c, Buffer.from('rest\n{"ok":1}\n'), big.length, got.fn);
    assert.deepEqual(got.lines, ['{"ok":1}']);
  });
});

describe('drain', () => {
  it('reads appends, holds a torn line until its newline arrives, and stops at none', async () => {
    const p = file();
    writeFileSync(p, '{"a":1}\n{"par');
    const c = newCursor(p);
    const got = collect();
    assert.equal((await drain(c, got.fn)).state, 'data');
    assert.deepEqual(got.lines, ['{"a":1}']);
    assert.equal((await drain(c, got.fn)).state, 'none');
    appendFileSync(p, 'tial":2}\n');
    assert.equal((await drain(c, got.fn)).state, 'data');
    assert.deepEqual(got.lines, ['{"a":1}', '{"partial":2}']);
  });

  it('reports a shrink and restarts inside the file with no stale carry', async () => {
    const p = file();
    writeFileSync(p, `${'{"a":1}\n'.repeat(100)}{"torn`);
    const c = newCursor(p);
    const got = collect();
    await drain(c, got.fn);
    assert.ok(c.carry);
    truncateSync(p, 40);
    const res = await drain(c, got.fn, 16);
    assert.equal(res.state, 'reset');
    assert.equal(res.state === 'reset' ? res.reason : '', 'shrunk');
    assert.equal(c.carry, null);
    assert.equal(c.offset, 40);
  });

  it('replays the small remainder after a shrink to near zero', async () => {
    const p = file();
    writeFileSync(p, '{"a":1}\n'.repeat(50));
    const c = newCursor(p);
    await drain(c, () => {});
    writeFileSync(p, '{"new":1}\n');
    const got = collect();
    const res = await drain(c, got.fn);
    assert.equal(res.state, 'reset');
    assert.deepEqual(got.lines, ['{"new":1}']);
  });

  it('treats a vanished file as gone, not as an error', async () => {
    const c = newCursor(path.join(dir, 'never.jsonl'));
    assert.equal((await drain(c, () => {})).state, 'gone');
  });
});

describe('readHeadTail', () => {
  it('returns a small file whole, so nothing is read twice', async () => {
    const p = file();
    writeFileSync(p, 'x'.repeat(100));
    const read = await readHeadTail(p, 100, 64, 64);
    assert.ok(read);
    assert.equal(read.head.length, 0);
    assert.equal(read.tail.length, 100);
    assert.equal(read.tailFrom, 0);
  });

  it('splits a large file', async () => {
    const p = file();
    writeFileSync(p, 'x'.repeat(1000));
    const read = await readHeadTail(p, 1000, 64, 128);
    assert.ok(read);
    assert.equal(read.head.length, 64);
    assert.equal(read.tail.length, 128);
    assert.equal(read.tailFrom, 872);
  });
});

describe('parseLine', () => {
  it('ignores and counts unknown record types and fields, and never throws', () => {
    const sensor = new Sensor();
    assert.equal(parseLine(Buffer.from('{"type":"brand-new-type","a":1}'), sensor), null);
    assert.equal(sensor.state.unknownRecords, 1);
    const r = parseLine(Buffer.from('{"type":"user","newField":1,"another":2}'), sensor);
    assert.ok(r);
    assert.equal(sensor.state.unknownFields, 2);
    assert.deepEqual([...sensor.unknownFieldNames], ['newField', 'another']);
    assert.equal(parseLine(Buffer.from('{not json'), sensor), null);
    assert.equal(parseLine(Buffer.from('[1,2]'), sensor), null);
    assert.equal(parseLine(Buffer.from('null'), sensor), null);
    assert.equal(sensor.state.parseErrors, 3);
    assert.equal(parseLine(Buffer.from('{"no":"type"}'), sensor), null);
    assert.equal(sensor.state.unknownRecords, 2);
  });

  it('skips request bodies by prefix without parsing, and keeps api-request itself', () => {
    const sensor = new Sensor();
    assert.equal(isApiRequestBody(Buffer.from('{"type":"api-request-blob","message":{')), true);
    assert.equal(isApiRequestBody(Buffer.from('{"type":"api-request-shape"')), true);
    assert.equal(isApiRequestBody(Buffer.from('{"type":"api-request","id":"x"}')), false);
    assert.equal(parseLine(Buffer.from('{"type":"api-request-blob","broken'), sensor), null);
    assert.equal(sensor.state.parseErrors, 0);
    assert.ok(parseLine(Buffer.from('{"type":"api-request","id":"x"}'), sensor));
  });
});
