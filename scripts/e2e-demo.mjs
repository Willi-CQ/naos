// Use the actual demo controls and production renderer, on isolated fixture data with no model calls.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, parseArgs } from 'node:util';

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, '.shots/demo');
mkdirSync(out, { recursive: true });
const { values: options } = parseArgs({ options: { only: { type: 'string' } } });
const only = options.only ? new Set(options.only.split(',')) : null;

const setup = `
  const c=window.__naosScene, state=()=>window.__naos.getState();
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async test=>{const end=performance.now()+45000;while(!test()){if(performance.now()>end)throw new Error('Demo timed out: '+JSON.stringify(state().scene.demo));await wait(35);}};
  const button=name=>document.querySelector('[data-demo="'+name+'"]');
  const visible=()=>{const ships=[];c.demoFleet?.forEachSlot(s=>{if(s.drawn)ships.push(s);});return ships;};
  const identity=()=>JSON.stringify([Object.keys(state().fleet.nodes),Object.keys(state().fleet.sessions),state().model.craftCount]);
  const before=identity();
  const requests=[],fetchOriginal=window.fetch;
  window.fetch=(...args)=>{if(args[1]?.method==='POST'){const input=JSON.parse(args[1].body);if(!['ui.presence','craft.channel','history.get'].includes(input.type)||input.nodeId?.startsWith('demo:'))requests.push(input.type);}return fetchOriginal(...args);};
  button('start').click();
  await until(()=>!!c.demoFleet);
`;

const formation = (reduced = false) => `(async()=>{${setup}
  ${reduced ? '' : `button('speed').click();await until(()=>state().scene.demo.elapsed>=11);button('pause').click();`}
  await wait(200);
  const ships=visible(), f=state().shell.free;
  const positions=()=>JSON.stringify([...c.demoFleet.slots.values()].filter(s=>s.drawn).map(s=>s.pos.toArray()));
  const held=positions();await wait(300);
  const labels=[...document.querySelectorAll('.demo-labels span:not([hidden])')].map(n=>n.getBoundingClientRect());
  const overlap=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  const panel=document.querySelector('.demo-controls').getBoundingClientRect(),filters=document.querySelector('.client-filters').getBoundingClientRect();
  const checks={
    allFourShips:ships.length===4,
    allThreeClients:['claude-code','codex','cursor'].every(client=>[...c.demoFleet.slots.values()].some(s=>s.drawn&&s.c.role==='tender'&&s.c.client===client)),
    historyDoesNotHideNewShips:[...c.demoFleet.slots.values()].filter(s=>s.c.id.startsWith('demo:history:')).every(s=>!s.drawn),
    shipsInView:ships.every(s=>Math.abs(s.x)<f.w/2-12&&Math.abs(s.y)<f.h/2-12),
    readableSpacing:ships.every((a,i)=>ships.every((b,j)=>i===j||Math.hypot(a.x-b.x,a.y-b.y)>18)),
    childrenClearOfPlanets:[...c.demoFleet.slots.values()].filter(s=>s.drawn&&s.c.role==='tender').every(s=>!c.isHidden(s.pos)),
    pauseHoldsShips:held===positions(),
    fourLabels:labels.length===4,
    labelsDoNotOverlap:labels.every((a,i)=>labels.every((b,j)=>i===j||!overlap(a,b))),
    controlsInCorner:panel.right<=innerWidth&&panel.left>=0&&!overlap(panel,filters),
    realSessionsUnchanged:identity()===before,
    noControlCommands:requests.length===0,
    ${reduced ? "staticRespectsPreference:c.state.still&&state().scene.demo.paused&&button('pause').disabled," : "speedWorks:!state().scene.demo.slow,"}
  };
  return {checks,ships,requests,phase:state().scene.demo.phase};
})()`;

const lifecycle = `(async()=>{${setup}
  button('speed').click();
  await until(()=>[...c.demoFleet.slots.values()].some(s=>s.departing&&s.c.role==='vessel'));
  const launchesFromRim=[...c.demoFleet.slots.values()].find(s=>s.departing)?.birthFrom.length()>100;
  await until(()=>[...c.demoFleet.slots.values()].some(s=>s.departing&&s.c.role==='tender'));
  const tenderLaunch=true;
  await until(()=>state().scene.demo.elapsed>=16);
  const lead=c.demoFleet.slots.get('demo:lead'), berth=lead.berth>=0&&lead.park>0;
  await until(()=>state().scene.demo.elapsed>=19);
  const sameIdentity=c.demoFleet.slots.get('demo:lead')===lead&&lead.parkTo===0;
  await until(()=>c.demoFleet.fx.some(f=>f.on&&f.kind==='fall'));
  const falling=c.demoFleet.fx.find(f=>f.on&&f.kind==='fall'), draws=[];
  c.demoFleet.drawShips(s=>draws.push(s));
  const landingHasHull=draws.includes(falling.from.ship);
  await until(()=>state().scene.demo.phase==='Complete');
  const finished=state().scene.demo.paused&&visible().length===0;
  button('replay').click();await wait(250);
  const replay=state().scene.demo.run===2&&state().scene.demo.elapsed<1&&visible().length===1;
  button('replay').click();await wait(250);
  const repeat=state().scene.demo.run===3&&c.demoFleet.slots.size===13;
  button('stop').click();await until(()=>!c.demoFleet);await wait(200);
  return {checks:{launchesFromRim,tenderLaunch,berth,sameIdentity,landingHasHull,finished,replay,repeat,
    closed:!state().scene.demo.active&&!document.querySelector('.demo-labels')&&!!button('start'),
    realSessionsUnchanged:identity()===before,noControlCommands:requests.length===0}};
})()`;

const navigation = `(async()=>{${setup}
  button('speed').click();await until(()=>state().scene.demo.elapsed>=11);button('pause').click();await wait(100);
  document.querySelector('.fleet-eyebrow button')?.click();
  await wait(2200);
  const system=state().view.level==='system'&&visible().length===4;
  // Number keys use the normal project navigation, just as they do outside the preview.
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'1',bubbles:true,cancelable:true}));
  await wait(2200);
  const world=state().view.level==='world'&&visible().length===4;
  document.querySelector('[data-angle="horizon"]').click();await wait(2200);
  const finite=[...c.demoFleet.slots.values()].filter(s=>s.drawn).every(s=>s.pos.toArray().every(Number.isFinite));
  button('stop').click();await until(()=>!c.demoFleet);
  return {checks:{system,world,finite,realSessionsUnchanged:identity()===before,noControlCommands:requests.length===0}};
})()`;

const dismissal = `(async()=>{${setup}
  const key=k=>{document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));document.body.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true}));};
  key('t');await until(()=>state().view.sky&&!c.demoFleet);
  const skyCloses=!state().scene.demo.active&&!button('start');
  key('t');await until(()=>!!button('start'));
  button('start').click();await until(()=>!!c.demoFleet);
  key('j');key('Enter');await until(()=>state().view.level==='craft'&&!c.demoFleet);
  const craftCloses=!state().scene.demo.active&&!button('start');
  key('0');await until(()=>!!button('start'));await wait(1400);
  button('start').click();await until(()=>!!c.demoFleet);
  c.lose();await until(()=>state().scene.context==='lost'&&!c.demoFleet);
  const contextCloses=!state().scene.demo.active;
  c.restore();await until(()=>state().scene.mounted&&state().scene.planets?.ready===state().scene.planets?.total&&Number(getComputedStyle(document.getElementById('scene-slot')).opacity)>.99);await wait(150);
  return {checks:{skyCloses,craftCloses,contextCloses,recovery:!!button('start')&&!c.demoFleet,
    realSessionsUnchanged:identity()===before,noControlCommands:requests.length===0}};
})()`;

const cases = [
  { name: 'fleet', viewport: '1600x1000', eval: formation() },
  { name: 'world', viewport: '1280x800', keys: '2', eval: formation() },
  { name: 'compact', viewport: '1024x768', eval: formation() },
  { name: 'reduced', viewport: '1280x800', reduced: true, eval: formation(true) },
  { name: 'lifecycle', viewport: '1280x800', eval: lifecycle },
  { name: 'navigation', viewport: '1280x800', keys: '2', eval: navigation },
  { name: 'dismissal', viewport: '1280x800', eval: dismissal },
];
const reports=[];
for(const item of cases){
  if(only&&!only.has(item.name)) continue;
  const args=['scripts/shot.mjs','--name',item.name,'--out',out,'--viewport',item.viewport,'--dpr','1.25','--seek','60','--pause','--mounted','--settled','--wait','1800','--eval',item.eval];
  if(item.keys)args.push('--keys',item.keys);
  if(item.reduced)args.push('--reduced');
  const result=await run(process.execPath,args,{cwd:repo,windowsHide:true,maxBuffer:2*1024*1024});
  const report=JSON.parse(result.stdout);
  writeFileSync(path.join(out,item.name+'.json'),JSON.stringify(report,null,2));
  assert.deepEqual(report.consoleErrors,[],item.name+': console errors');
  assert.deepEqual(report.pageErrors,[],item.name+': page errors');
  assert.deepEqual(report.failedRequests,[],item.name+': requests');
  for(const [name,passed] of Object.entries(report.eval.checks))assert.equal(passed,true,item.name+': '+name);
  reports.push(report);
  console.log('PASS '+item.name+': '+Object.keys(report.eval.checks).join(', '));
}
const review=cases.flatMap(item=>{
  const current=reports.find(report=>report.name===item.name),file=path.join(out,item.name+'.json');
  return current?[current]:existsSync(file)?[JSON.parse(readFileSync(file,'utf8'))]:[];
});
writeFileSync(path.join(out,'review.json'),JSON.stringify(review,null,2));
