// DocketBody, DESIGN 8.4 and the rendering rules of 3.6. React escapes all of it, and nothing here uses raw HTML: tool input is steered
// by a model, and a plan can hold anything.
import type { ApprovalView } from '@naos/protocol';
import {
  activeQuestion, bodyKind, diffLines, escapeUntrusted, markdown, mcpParts, pretty, previewOf, questionsOf, serverTrusted, text,
} from './card.ts';
import { pickOption, useDocket } from './controller.ts';

function Blocked({ path }: { path: string | null }) {
  if (!path) return null;
  return (
    <>
      <div className="dk-sub t-micro">blocked path</div>
      <div className="dk-path t-num">{path}</div>
    </>
  );
}

function BashBody({ a }: { a: ApprovalView }) {
  return (
    <>
      <pre className="dk-code t-code">{text(a.input.command) || pretty(a.input)}</pre>
      {a.description ? <p className="dk-desc t-body">{a.description}</p> : null}
      <Blocked path={a.blockedPath} />
    </>
  );
}

function WriteBody({ a, wide }: { a: ApprovalView; wide: boolean }) {
  const content = text(a.input.content);
  const preview = previewOf(content, wide ? 400 : 12);
  return (
    <>
      <div className="dk-path t-num">{text(a.input.file_path)}</div>
      <pre className="dk-code dk-scroll t-num-s" tabIndex={0} aria-label="File preview">{preview.shown}</pre>
      <div className="dk-sub t-micro">{preview.total} {preview.total === 1 ? 'line' : 'lines'}{preview.more > 0 ? `, ${preview.more} more, O opens wide` : ''}</div>
      <Blocked path={a.blockedPath} />
    </>
  );
}

function EditBody({ a }: { a: ApprovalView }) {
  const rows = diffLines(text(a.input.old_string), text(a.input.new_string));
  return (
    <>
      <div className="dk-path t-num">{text(a.input.file_path)}</div>
      <pre className="dk-code dk-scroll dk-diff t-num-s" tabIndex={0} aria-label="Diff">
        {rows.map((row, i) => <span key={i} data-kind={row.kind}>{row.kind === 'del' ? '- ' : row.kind === 'add' ? '+ ' : '  '}{row.text}{'\n'}</span>)}
      </pre>
      <Blocked path={a.blockedPath} />
    </>
  );
}

function PlanBody({ a }: { a: ApprovalView }) {
  return (
    <div className="dk-plan dk-scroll t-body" tabIndex={0} aria-label="Plan">
      {markdown(text(a.input.plan)).map((block, i) => {
        switch (block.kind) {
          case 'heading': return <div key={i} className="t-body-b dk-plan-h">{block.text}</div>;
          case 'item': return <div key={i} className="dk-plan-li"><span className="c-slag">{block.marker}</span><span>{block.text}</span></div>;
          case 'code': return <pre key={i} className="dk-code t-num-s">{block.text}</pre>;
          default: return <p key={i}>{block.text}</p>;
        }
      })}
    </div>
  );
}

function QuestionBody({ a }: { a: ApprovalView }) {
  const picks = useDocket((s) => s.picks);
  const questions = questionsOf(a.input);
  if (questions.length === 0) return <p className="t-body c-slag">This form came without questions. Deny, or redirect.</p>;
  const active = activeQuestion(questions, picks);
  return (
    <div className="dk-form">
      {questions.map((q, at) => (
        <fieldset key={at} data-active={at === active}>
          <legend className="t-body-b">{q.header ? `${q.header}: ` : ''}{q.question}</legend>
          {q.options.map((option, n) => {
            const on = (picks[at] ?? []).includes(n);
            return (
              <button key={n} type="button" className="dk-opt" role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} aria-keyshortcuts={String(n + 1)} onClick={() => pickOption(at, n)}>
                <b>{n + 1}</b>
                <span className="t-body">{option.label}</span>
                {option.description ? <span className="t-micro c-slag">{option.description}</span> : null}
              </button>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function McpBody({ a }: { a: ApprovalView }) {
  const parts = mcpParts(a.toolName);
  const server = a.mcpServer?.name ?? parts.server;
  const trusted = serverTrusted(a.mcpServer);
  return (
    <>
      <div className="kv"><span className="k">SERVER</span><span className="v">{escapeUntrusted(server)}{trusted ? '' : ' (name not verified)'}</span></div>
      <div className="kv"><span className="k">SOURCE</span><span className="v">{a.mcpServer?.source ?? 'unknown'}</span></div>
      <div className="kv"><span className="k">TOOL</span><span className="v">{a.displayName ?? parts.tool}</span></div>
      {a.title ? <p className="dk-desc t-body">{a.title}</p> : null}
      <pre className="dk-code dk-scroll t-num-s" tabIndex={0} aria-label="Arguments">{pretty(a.input)}</pre>
    </>
  );
}

function OtherBody({ a }: { a: ApprovalView }) {
  return (
    <>
      {a.description ? <p className="dk-desc t-body">{a.description}</p> : null}
      <pre className="dk-code dk-scroll t-num-s" tabIndex={0} aria-label="Input">{pretty(a.input)}</pre>
      <Blocked path={a.blockedPath} />
    </>
  );
}

export function DocketBody({ a, wide }: { a: ApprovalView; wide: boolean }) {
  switch (bodyKind(a)) {
    case 'bash': return <BashBody a={a} />;
    case 'write': return <WriteBody a={a} wide={wide} />;
    case 'edit': return <EditBody a={a} />;
    case 'plan': return <PlanBody a={a} />;
    case 'question': return <QuestionBody a={a} />;
    case 'mcp': return <McpBody a={a} />;
    default: return <OtherBody a={a} />;
  }
}
