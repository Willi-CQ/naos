import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, parseArgs } from 'node:util';

const run = promisify(execFile), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, '.shots/observatory'); mkdirSync(out, { recursive: true });
const { values: options } = parseArgs({ options: { only: { type: 'string' } } });
const only = options.only ? new Set(options.only.split(',')) : null;
const setup = `
  const c=window.__naosScene,s=()=>window.__naos.getState(),wait=ms=>new Promise(r=>setTimeout(r,ms));
  const key=k=>{document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));document.body.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true}));};
  const setValue=(node,value)=>{Object.getOwnPropertyDescriptor(node instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLInputElement?'input':'change',{bubbles:true}));};
  const atlas=()=>document.querySelector('.observatory');
  const scene=()=>c.harbor?.parent;
  const find=name=>{const nodes=[];scene()?.traverse(n=>{if(n.name===name)nodes.push(n);});return nodes;};
`;
const layout = (map = false) => `(async()=>{${setup}
  key('p');await wait(350);
  if(${map}){document.querySelector('[data-atlas-view="map"]').click();await wait(100);}
  else{document.querySelectorAll('.atlas-card')[1]?.click();await wait(100);}
  const panel=atlas().getBoundingClientRect(),f=s().shell.free,enter=document.querySelector('[data-observatory="enter"]').getBoundingClientRect();
  const focus=document.activeElement;
  const checks={
    opened:!!atlas(),allWorlds:document.querySelectorAll(${map}?'.atlas-chart-world':'.atlas-card').length===s().model.allWorlds.length,
    railsClear:panel.left>=f.x&&panel.right<=f.x+f.w,
    noPageOverflow:document.documentElement.scrollWidth<=innerWidth,
    enterAlwaysVisible:enter.top>panel.top&&enter.bottom<panel.bottom,
    focusInside:atlas().contains(focus),needsYouReachable:document.querySelector('.rail')?.getBoundingClientRect().left>=panel.right,
  };
  return {checks,worlds:s().model.allWorlds.length};
})()`;

const interaction = `(async()=>{${setup}
  const before=JSON.stringify([Object.keys(s().fleet.sessions),Object.keys(s().fleet.nodes)]),requests=[],original=fetch;
  window.fetch=(...args)=>{if(args[1]?.method==='POST'){const input=JSON.parse(args[1].body);if(!['ui.presence','craft.channel','history.get'].includes(input.type))requests.push(input.type);}return original(...args);};
  document.querySelector('[data-observatory="open"]').focus();document.querySelector('[data-observatory="open"]').click();await wait(250);
  const input=document.querySelector('[aria-label="Search projects"]');setValue(input,'zz-no-such-sector-zz');await wait(150);
  const empty=!!document.querySelector('.atlas-empty')&&!document.querySelector('[data-observatory="enter"]');
  document.querySelector('.atlas-empty button').click();await wait(100);
  const allBack=document.querySelectorAll('.atlas-card').length===s().model.allWorlds.length;
  setValue(document.querySelector('[aria-label="Order projects"]'),'activity');await wait(100);
  const first=document.querySelector('.atlas-card'),id=first.dataset.world;first.click();await wait(100);
  document.querySelector('[data-observatory="enter"]').click();await wait(1500);
  const flew=s().view.level==='world'&&s().view.worldId===id&&!atlas();
  key('p');await wait(250);
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'.',code:'Period',ctrlKey:true,bubbles:true,cancelable:true}));await wait(250);
  const docketReachable=s().view.overlays.some(o=>o.id==='docket')&&s().model.decisions.some(d=>d.status==='open');
  key('Escape');await wait(200);key('Escape');await wait(250);
  return {checks:{empty,allBack,flew,docketReachable,escapeCloses:!atlas(),sessionsUntouched:JSON.stringify([Object.keys(s().fleet.sessions),Object.keys(s().fleet.nodes)])===before,noControlCommands:requests.length===0}};
})()`;

const veil = `(async()=>{${setup}
  document.querySelector('.client-filters button[data-client="codex"]').click();await wait(300);key('p');await wait(300);
  const text=atlas().textContent;
  const raw=Object.values(s().fleet.worlds).map(w=>w.projectRoot).filter(Boolean);
  const main=Object.values(s().model.crafts).filter(x=>x.live&&x.visible&&x.kind==='main');
  return {checks:{veiled:s().view.settings.veil,pathsPrivate:raw.every(p=>!text.includes(p)),
    namesMatch:s().model.allWorlds.every(w=>[...document.querySelectorAll('.atlas-card h3')].some(n=>n.textContent===w.name)),
    filtered:main.length>0&&main.every(x=>x.client==='codex')&&text.includes(main.length+' open chats'),
    noWrongClient:!document.querySelector('.atlas-clients [data-client="claude-code"]')&&!document.querySelector('.atlas-clients [data-client="cursor"]')}};
})()`;

const atmosphere = `(async()=>{${setup}
  const lights=find('polar-lights'),field=find('activity-signals')[0];
  const uniforms=()=>lights.map(n=>n.material.uniforms.uTime.value);
  const time=JSON.stringify(uniforms());await wait(250);
  const checks={polarLightsPresent:lights.length>0,finiteLightUniforms:uniforms().every(Number.isFinite)};
  checks.motionPreference=c.state.still?JSON.stringify(uniforms())===time:JSON.stringify(uniforms())!==time;
  key('0');await wait(1600);
  checks.routesPresent=!!field&&field.visible&&field.children[0].geometry.drawRange.count>0;
  document.querySelector('[data-observatory="signals"]').click();await wait(200);
  checks.routesSwitchOff=!field.visible&&!s().view.settings.signalRoutes;
  key(',');await wait(250);document.querySelector('[role="switch"][aria-label="Polar lights"]').click();key('Escape');await wait(250);
  checks.aurorasSwitchOff=lights.every(n=>!n.visible)&&!s().view.settings.auroras;
  return {checks};
})()`;

const performance = `(async()=>{${setup}
  const m=await c.measure(5000);return {checks:{gpuSamples:m.gpu.count>0,drawBudget:m.calls<100,triangleBudget:m.triangles<40000},performance:{frames:m.frames,gpu:m.gpu,cpu:m.cpu,calls:m.calls,triangles:m.triangles}};
})()`;
const cases = [
  {name:'atlas',viewport:'1600x1000',eval:layout()},
  {name:'constellation',viewport:'1280x800',eval:layout(true)},
  {name:'compact',viewport:'1024x768',eval:layout()},
  {name:'interaction',viewport:'1280x800',eval:interaction},
  {name:'veil',viewport:'1280x800',veil:true,eval:veil},
  {name:'polar-lights',viewport:'1280x800',keys:'2',eval:atmosphere},
  {name:'reduced',viewport:'1280x800',keys:'2',reduced:true,eval:atmosphere},
  {name:'performance',viewport:'1280x800',eval:performance},
];
for(const item of cases){
  if(only&&!only.has(item.name))continue;
  const args=['scripts/shot.mjs','--name',item.name,'--out',out,'--viewport',item.viewport,'--dpr','1.5','--seek','60','--pause','--mounted','--settled','--wait','1800','--eval',item.eval];
  if(item.keys)args.push('--keys',item.keys);if(item.reduced)args.push('--reduced');if(item.veil)args.push('--veil');
  const result=await run(process.execPath,args,{cwd:repo,windowsHide:true,maxBuffer:2*1024*1024});
  const report=JSON.parse(result.stdout);
  assert.deepEqual(report.consoleErrors,[],item.name+': console');assert.deepEqual(report.pageErrors,[],item.name+': page');assert.deepEqual(report.failedRequests,[],item.name+': requests');
  for(const [name,passed] of Object.entries(report.eval.checks))assert.equal(passed,true,item.name+': '+name);
  console.log('PASS '+item.name+': '+Object.keys(report.eval.checks).join(', '));
}
const review=cases.flatMap(item=>{const file=path.join(out,item.name+'.json');return existsSync(file)?[JSON.parse(readFileSync(file,'utf8'))]:[];});
writeFileSync(path.join(out,'review.json'),JSON.stringify(review,null,2));
