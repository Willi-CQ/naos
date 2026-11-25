// Exercise real fixture events through the normal screenshot path. No synthetic fleet events or model calls.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';

const run = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, '.shots/lifecycle');
mkdirSync(out, { recursive: true });
const { values: options } = parseArgs({ options: { only: { type: 'string' } } });
const only = options.only ? new Set(options.only.split(',')) : null;

const eventShot = (kind) => `(async()=>{
  const c=window.__naosScene;
  const cmd=async action=>(await fetch('/api/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'fixture.control',action})})).json();
  await cmd('play');
  let found=null;
  const until=performance.now()+7000;
  while(performance.now()<until){
    if('${kind}'==='landing') found=c.fleet.fx.find(f=>f.on&&f.kind==='fall');
    else found=[...c.fleet.slots.values()].find(s=>s.departing&&s.c.role===('${kind}'==='launch'?'vessel':'tender'));
    if(found) break;
    await new Promise(r=>setTimeout(r,35));
  }
  await cmd('pause');
  if(!found) throw new Error('No ${kind} was rendered from the fixture event');
  if('${kind}'==='landing'){
    const draws=[]; c.fleet.drawShips(s=>draws.push(s));
    return {checks:{landingHasHull:draws.includes(found.from.ship),landingRetainsIdentity:!!found.from.c.id},kind:found.from.kind};
  }
  return {checks:{shipIsDrawn:found.drawn,finitePosition:found.pos.toArray().every(Number.isFinite),startsOutsideShadow:found.birthFrom.length()>100||'${kind}'==='tender'},kind:found.kind};
})()`;

const journey = `(async()=>{
  const c=window.__naosScene, state=window.__naos.getState();
  const selection=state.view.selected;
  const before=c.camera.position.clone();
  document.querySelector('[data-tour="system"]').click();
  await new Promise(r=>setTimeout(r,10000));
  const moving=c.rig.touring&&c.camera.position.distanceTo(before)>100;
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Shift',bubbles:true,cancelable:true}));
  const stopped=!c.rig.touring;
  const at=c.camera.position.clone();
  await new Promise(r=>setTimeout(r,150));
  return {checks:{journeyMoved:moving,inputStopsImmediately:stopped,noJumpAfterStop:c.camera.position.distanceTo(at)<.01,selectionHeld:window.__naos.getState().view.selected===selection}};
})()`;

const cases = [
  { name: 'launch', t: 89, eval: eventShot('launch') },
  { name: 'tender', t: 54, eval: eventShot('tender') },
  { name: 'landing', t: 143, keys: '2', eval: eventShot('landing') },
  { name: 'system-tour', t: 60, eval: journey },
  { name: 'tour-complete', t: 60, eval: `(()=>{const c=window.__naosScene; c.rig.startJourney(); let finite=true,clear=true; for(let i=0;i<600;i++){c.rig.step(.1); finite=finite&&c.camera.position.toArray().every(Number.isFinite); for(const b of c.worldSpots()) clear=clear&&c.camera.position.distanceTo({x:b.position[0],y:b.position[1],z:b.position[2]})>=b.radius;} return {checks:{routeFinishes:!c.rig.touring,finite,clear}};})()` },
  { name: 'snapshot', t: 92, eval: `(()=>{const ships=[...window.__naosScene.fleet.slots.values()];const idle=ships.filter(s=>s.c.role==='vessel'&&!s.c.moon&&(s.c.state==='idle'||s.c.state==='idle-shell'));return {checks:{noReplay:ships.every(s=>!s.departing),idleHasBerth:idle.length>0&&idle.every(s=>s.berth>=0&&s.park===1)}};})()` },
  { name: 'undock', t: 109, keys: '2', eval: `(async()=>{
    const c=window.__naosScene;
    const ship=[...c.fleet.slots.values()].find(s=>s.c.client==='cursor'&&s.c.state==='idle');
    if(!ship) throw new Error('No idle Cursor ship');
    const id=ship.c.id;
    const cmd=action=>fetch('/api/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'fixture.control',action})});
    await cmd('play');
    const until=performance.now()+6000;
    while(performance.now()<until&&!ship.parking) await new Promise(r=>setTimeout(r,30));
    await cmd('pause');
    return {checks:{sameShip:c.fleet.slots.get(id)===ship,leavesBerth:ship.parking&&ship.parkTo===0,noSecondLaunch:!ship.departing&&!Number.isFinite(ship.birthAt)}};
  })()` },
  { name: 'harbor', t: 60, keys: '2', eval: `(()=>{const c=window.__naosScene,h=c.harbor,p=h?.position.clone().project(c.camera); return {checks:{dockMounted:!!h?.visible&&h.parent?.type==='Scene',dockInView:!!p&&Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z<1}};})()` },
  { name: 'reduced', t: 60, reduced: true, eval: `({checks:{tourDisabled:document.querySelector('[data-tour="system"]').disabled,routeHeld:window.__naosScene.rig.startJourney()===false}})` },
];
const reports=[];
for(const item of cases){
  if(only&&!only.has(item.name)) continue;
  const args=['scripts/shot.mjs','--name',item.name,'--out',out,'--viewport','1600x1000','--dpr','1.25','--seek',String(item.t),'--pause','--mounted','--settled','--wait','1800','--eval',item.eval];
  if(item.keys) args.push('--keys',item.keys);
  if(item.reduced) args.push('--reduced');
  const result=await run(process.execPath,args,{cwd:repo,windowsHide:true,maxBuffer:2*1024*1024});
  const report=JSON.parse(result.stdout);
  assert.deepEqual(report.consoleErrors,[],`${item.name}: console errors`);
  assert.deepEqual(report.pageErrors,[],`${item.name}: page errors`);
  assert.deepEqual(report.failedRequests,[],`${item.name}: requests`);
  for(const [name,passed] of Object.entries(report.eval.checks)) assert.equal(passed,true,`${item.name}: ${name}`);
  reports.push(report);
  console.log(`PASS ${item.name}: ${Object.keys(report.eval.checks).join(', ')}`);
}
writeFileSync(path.join(out,'review.json'),JSON.stringify(reports,null,2));
