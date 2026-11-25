import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, parseArgs } from 'node:util';

const run = promisify(execFile), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, '.shots/project'); mkdirSync(out, { recursive: true });
const { values: options } = parseArgs({ options: { only: { type: 'string' } } });
const setup = `
 const s=()=>window.__naos.getState(),wait=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(predicate)=>{const end=Date.now()+10000;while(!predicate()){if(Date.now()>end)throw new Error('Timed out waiting for the project UI');await wait(40);}};
 const promptContext=value=>{const line=value.split(String.fromCharCode(10),1)[0],prefix='[[naos-context:v1:';return line.startsWith(prefix)?JSON.parse(decodeURIComponent(line.slice(prefix.length,-2))):null;};
 const promptText=value=>{const marker='[[/naos-context]]',at=value.indexOf(marker);return at<0?value:value.slice(at+marker.length).trimStart();};
 const key=k=>{document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));};
 const value=(node,text)=>{Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value').set.call(node,text);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));};
 const checks={};
 key('p');await until(()=>document.querySelector('[data-observatory=surface]'));document.querySelector('[data-observatory=surface]').click();await until(()=>document.querySelector('.map-region'));
 const surface=()=>document.querySelector('.project-window'),message=()=>document.querySelector('[aria-label="Message project agent"]');
 const showAgents=async()=>{document.querySelector('[data-view="chat"]').click();await until(()=>document.querySelector('.agent-observatory'));await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));};
 const newChat=()=>{if(document.querySelector('[aria-label="Project conversation"]').value)document.querySelector('[aria-label="New project chat"]').click();};
 const freshChat=async()=>{newChat();await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));};
 const press=(key,extra={})=>message().dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
 const slash=async(text)=>{value(message(),text);await wait(60);press('Enter');await wait(80);};
`;
const layout = `(async()=>{${setup}
 const box=surface().getBoundingClientRect();
 checks.regionsMapped=document.querySelectorAll('.map-region').length===6;
 checks.mapUsesWorkspace=getComputedStyle(document.querySelector('.project-agent-stage')).display==='none';
 checks.focusInside=surface().contains(document.activeElement);
 checks.noPageOverflow=document.documentElement.scrollWidth<=innerWidth;
 checks.windowFits=box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
 const first=document.querySelector('.map-region');first.focus();first.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(80);
 checks.selectionContext=document.querySelector('[aria-label="Selected project area"]')?.textContent.includes(first.dataset.region);
 const svg=document.querySelector('.project-map>svg'),before=svg.getAttribute('viewBox');
 document.querySelector('[aria-label="Zoom in"]').click();await wait(70);
 checks.zoomWorks=svg.getAttribute('viewBox')!==before;
 document.querySelector('[title="Reset map view"]').click();await wait(70);
 checks.resetWorks=svg.getAttribute('viewBox')===before;
 const styles=[...document.querySelectorAll('[aria-label="Map representation"] button')];styles[1].click();await wait(70);
 checks.topographyWorks=!!document.querySelector('.expedition-elevation')&&!document.querySelector('.expedition-terrain');
 checks.projectOnlyLayers=styles.length===2&&!surface().textContent.includes('Constellation')&&!surface().querySelector('.atlas-constellation');styles[0].click();await wait(70);
 checks.landscapeRestored=!!document.querySelector('.expedition-terrain');
 checks.scopedLandscape=document.querySelector('[data-map-world]').dataset.mapWorld===document.querySelector('[aria-label="Explore project"]').value;
 checks.scopedAgents=[...document.querySelectorAll('[data-local-agent]')].every(row=>s().model.crafts[row.dataset.localAgent]?.worldId===document.querySelector('[aria-label="Explore project"]').value);
 checks.realLanguages=document.querySelector('[aria-label="Project languages"]').textContent.includes('TypeScript');
 await showAgents();await wait(100);checks.chatVisible=getComputedStyle(document.querySelector('.project-agent-stage')).display!=='none';
 checks.telemetryVisible=!!document.querySelector('.agent-observatory');
 const compose=message().getBoundingClientRect();checks.composerFits=compose.top>box.top&&compose.bottom<box.bottom;
 document.querySelector('[data-view="map"]').click();await wait(80);
 return {checks};
})()`;

const interaction = `(async()=>{${setup}
 const sent=[],original=fetch;
 window.fetch=(...args)=>{if(args[1]?.method==='POST')sent.push(JSON.parse(args[1].body));return original(...args);};
 const initialWorld=document.querySelector('[aria-label="Explore project"]').value;
 const first=document.querySelector('.map-region');first.dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(80);const region=first.dataset.region;
 await showAgents();await freshChat();
 value(message(),'Review the selected area and explain the architecture.');await wait(80);
 const launch=document.querySelector('[aria-label="Start project agent"]');launch.click();launch.click();await wait(400);
 checks.oneSpawn=sent.filter(x=>x.type==='agent.spawn').length===1;
 const spawn=sent.find(x=>x.type==='agent.spawn');checks.correctProject=spawn?.spec.worldId===initialWorld;checks.codexIsDefault=spawn?.spec.client==='codex';
 checks.regionPassed=promptContext(spawn?.spec.prompt??'')?.focus===region&&promptText(spawn.spec.prompt).includes('Review the selected area');
 checks.preflightFirst=sent.findIndex(x=>x.type==='preflight')<sent.findIndex(x=>x.type==='agent.spawn');
 await original('/api/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'fixture.control',action:'play'})});await until(()=>s().fleet.managed[document.querySelector('[aria-label="Project conversation"]').value]?.sessionId);
 const selection=document.querySelector('[aria-label="Project conversation"]').value,agent=s().fleet.managed[selection];
 checks.agentSelected=!!agent&&agent.worldId===initialWorld;
 value(message(),'Continue with the smallest useful improvement.');await wait(80);document.querySelector('[aria-label="Send message"]').click();await wait(250);
 const followup=sent.find(x=>x.type==='agent.send'&&x.agentId===selection);checks.followup=!!followup&&followup.priority==='queue';checks.followupKeepsProjectContext=promptContext(followup?.text??'')?.focus===region;
 await until(()=>message()&&!message().disabled);value(message(),'Draft kept in this conversation');await wait(120);
 const worldSelect=document.querySelector('[aria-label="Explore project"]'),other=[...worldSelect.options].find(o=>o.value!==initialWorld).value;
 value(worldSelect,other);await wait(300);
 checks.projectIsolated=!message().value&&!document.querySelector('.project-messages').textContent.includes('smallest useful improvement');
 value(document.querySelector('[aria-label="Explore project"]'),initialWorld);await wait(350);
 checks.draftRetained=message().value==='Draft kept in this conversation';
 checks.sessionRetained=document.querySelector('[aria-label="Project conversation"]').value===selection;
 document.querySelector('[aria-label="Privacy veil"]').click();await wait(150);
 const veiledStart=sent.length;await wait(1400);
 checks.veilHidesMessages=!surface().textContent.includes('smallest useful improvement')&&!message().value;
 checks.veilHidesFiles=!document.querySelector('.map-region')&&!document.querySelector('.project-context');
 checks.veilStopsReads=!sent.slice(veiledStart).some(x=>['craft.text','world.survey'].includes(x.type));
 checks.veilBlocksInput=message().disabled;
 document.querySelector('[aria-label="Privacy veil"]').click();await wait(300);
 checks.draftReturns=message().value==='Draft kept in this conversation';
 checks.noExtraSpawns=sent.filter(x=>x.type==='agent.spawn').length===1;
 document.querySelector('[aria-label="Close project surface"]').click();await wait(180);
 checks.closeKeepsAgent=!!s().fleet.managed[selection]&&!sent.some(x=>x.type==='agent.stop');
 key('p');await wait(200);document.querySelector('[data-observatory=surface]').click();await wait(300);
 checks.reopenKeepsSession=document.querySelector('[aria-label="Project conversation"]').value===selection;
 return {checks,commands:sent.map(x=>x.type)};
})()`;

const clients = `(async()=>{${setup}
 await showAgents();
 const external=Object.values(s().model.crafts).find(c=>c.kind==='main'&&c.client==='codex'&&c.visible);
 value(document.querySelector('[aria-label="Explore project"]'),external.worldId);await wait(300);
 value(document.querySelector('[aria-label="Project conversation"]'),external.id);await wait(200);
 checks.externalHonest=surface().textContent.includes('shares activity only')&&!message();
 const approval=Object.values(s().fleet.approvals).find(a=>a.status==='open');
 value(document.querySelector('[aria-label="Explore project"]'),approval.worldId);await wait(300);
 value(document.querySelector('[aria-label="Project conversation"]'),approval.agentId);await wait(200);
 document.querySelector('.project-approval').click();await wait(350);
 checks.approvalOpens=!!document.querySelector('.docket');
 checks.approvalHasDecision=document.querySelector('.docket')?.textContent.includes(approval.toolName);
 checks.approvalFocus=document.querySelector('.docket')?.contains(document.activeElement);
 key('Escape');await wait(150);
 checks.surfaceSurvives=!!surface();
 return {checks};
})()`;

const refusals = `(async()=>{${setup}
 await showAgents();await freshChat();
 const original=fetch,spawns=[],before=Object.keys(s().fleet.managed).length;let blocked=true,loseReply=true,firstReceipt=null;
 window.fetch=async(...args)=>{
  const body=args[1]?.method==='POST'?JSON.parse(args[1].body):null;
  if(body?.type==='preflight'&&blocked)return new Response(JSON.stringify({ok:true,result:{blocked:'Launch paused for this test.'}}),{headers:{'content-type':'application/json'}});
  if(body?.type!=='agent.spawn')return original(...args);
  spawns.push(body.spec);const response=await original(...args),data=await response.json();
  if(loseReply){loseReply=false;firstReceipt=data.result;return new Response(JSON.stringify({ok:false,error:{code:'unavailable',message:'Reply interrupted. Retry the same launch.'}}),{headers:{'content-type':'application/json'}});}
  return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 };
 await slash('/plan');value(message(),'A prompt that must survive retries.');await wait(100);
 document.querySelector('[aria-label="Start project agent"]').click();await until(()=>document.querySelector('.project-chat-error'));
 checks.blockedDoesNotSpawn=spawns.length===0;
 checks.blockedKeepsDraft=message().value==='A prompt that must survive retries.';
 blocked=false;document.querySelector('.project-chat-error button').click();await until(()=>document.querySelector('.project-chat-error')?.textContent.includes('Reply interrupted'));
 checks.lostReplyKeepsDraft=message().value==='A prompt that must survive retries.';
 document.querySelector('.project-chat-error button').click();await until(()=>document.querySelector('[aria-label="Project conversation"]').value);
 checks.sameIdempotencyKey=spawns.length===2&&spawns[0].idempotencyKey===spawns[1].idempotencyKey;
 checks.oneActualAgent=Object.keys(s().fleet.managed).length===before+1;
 checks.sameReceipt=document.querySelector('[aria-label="Project conversation"]').value===firstReceipt.agentIds[0];
 checks.planModePassed=spawns.every(x=>x.mode==='plan-first'&&x.worktree===false);
 return {checks};
})()`;

const entrypoints = `(async()=>{${setup}
 document.querySelector('[aria-label="Close project surface"]').click();await wait(250);
 const row=document.querySelector('.m-world[data-world]'),world=row.dataset.world;
 row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await until(()=>surface());
 checks.manifestOpens=s().view.overlays.some(o=>o.id==='project'&&o.arg===world);
 document.querySelector('[aria-label="Close project surface"]').click();await wait(250);
 const controller=window.__naosScene,free=s().shell.free;
 const planet=controller.worldsOnCanvas().find(w=>w.onScreen&&!w.hidden);
 controller.open(planet.x+free.w/2,planet.y+free.h/2);await until(()=>surface());
 checks.planetOpens=s().view.overlays.some(o=>o.id==='project'&&o.arg===planet.id);
 document.querySelector('.project-breadcrumb button').click();await until(()=>document.querySelector('.observatory'));
 const card=document.querySelector('.atlas-card'),cardId=card.dataset.world;
 card.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await until(()=>surface());
 checks.atlasDoubleClick=s().view.overlays.some(o=>o.id==='project'&&o.arg===cardId);
 document.querySelector('[aria-label="Close project surface"]').click();await until(()=>!s().view.overlays.some(o=>o.id==='project'));
 key('l');await until(()=>surface()&&s().view.overlays.some(o=>o.id==='launch'));
 checks.launchKeyOpensProjectChat=!!document.querySelector('.quiet-chat')&&s().view.overlays.some(o=>o.id==='launch');
 const closeButtons=document.querySelectorAll('[aria-label="Close project surface"]');closeButtons[closeButtons.length-1].click();await until(()=>!s().view.overlays.some(o=>o.id==='launch'));
 checks.launchWindowCloses=!s().view.overlays.some(o=>o.id==='launch');
 return {checks};
})()`;

const providers = `(async()=>{${setup}
 await showAgents();await freshChat();
 await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));
 checks.defaultCodex=document.querySelector('[data-provider="codex"]').getAttribute('aria-pressed')==='true';
 await slash('/model fixture-codex');
 await slash('/provider cursor');await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));
 checks.modelReset=document.querySelector('[aria-label="Choose agent model"]').textContent==='Default';
 await slash('/model fixture-cursor');value(message(),'Cursor fixture task');await wait(80);
 const sent=[],original=fetch;let missing=false;
 window.fetch=(...args)=>{const body=args[1]?.method==='POST'?JSON.parse(args[1].body):null;if(body)sent.push(body);if(body?.type==='agent.providers'&&missing)return Promise.resolve(new Response(JSON.stringify({ok:true,result:[{client:'codex',installed:false,authenticated:false,auth:'unknown',models:[],message:'Codex CLI not installed',loginCommand:'codex login'},{client:'cursor',installed:false,authenticated:false,auth:'unknown',models:[],message:'Cursor CLI not installed',loginCommand:'agent login'}]}),{headers:{'content-type':'application/json'}}));return original(...args);};
 document.querySelector('[aria-label="Start project agent"]').click();await until(()=>s().fleet.managed[document.querySelector('[aria-label="Project conversation"]').value]?.client==='cursor');
 const spawn=sent.find(x=>x.type==='agent.spawn');checks.cursorLaunch=spawn.spec.client==='cursor'&&spawn.spec.model==='fixture-cursor';
 checks.noFakeDollarBudget=!document.querySelector('[aria-label="Agent budget"]')&&!document.querySelector('[aria-label="Increase agent budget"]');
 checks.cursorLabel=document.querySelector('.project-agent-state').textContent.includes('Cursor account limits');
 missing=true;document.querySelector('[aria-label="New project chat"]').click();await until(()=>document.querySelector('.project-provider-picker')?.textContent.includes('not installed'));
 value(message(),'Must not launch');await wait(80);checks.missingCliBlocksLaunch=document.querySelector('[aria-label="Start project agent"]').disabled;
 checks.setupLink=!!document.querySelector('.project-provider-picker a');checks.noExtraLaunch=sent.filter(x=>x.type==='agent.spawn').length===1;
 return {checks};
})()`;

const workflows = `(async()=>{${setup}
 const sent=[],original=fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST')sent.push(JSON.parse(args[1].body));return original(...args);};
 await showAgents();await freshChat();
 value(message(),'/skill');await wait(80);
 await until(()=>document.querySelector('[data-chat-command="user:shared:skill:project-tour"]'));
 checks.sharedSkillListed=!!document.querySelector('[data-chat-command="user:shared:skill:project-tour"]');
 checks.cursorCommandHiddenFromCodex=!document.querySelector('[data-chat-command="project:cursor:command:review"]');
 document.querySelector('[data-chat-command="user:shared:skill:project-tour"]').click();await until(()=>document.querySelector('.selected-workflow'));
 value(message(),'Explain the project using its installed tour workflow.');await wait(40);document.querySelector('[aria-label="Start project agent"]').click();
 await until(()=>sent.some(item=>item.type==='agent.spawn'));
 let spawn=sent.find(item=>item.type==='agent.spawn');
 checks.skillInstructionsPassed=spawn.spec.prompt.includes('Inspect the project structure')&&promptText(spawn.spec.prompt).includes('Explain the project using its installed tour workflow');
 checks.skillMetadataInTranscript=promptContext(spawn.spec.prompt)?.skill?.name==='project-tour';
 await slash('/new');await slash('/provider cursor');await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));
 value(message(),'/skill');await wait(80);await until(()=>document.querySelector('[data-chat-command="project:cursor:command:review"]'));checks.cursorCommandAvailable=!!document.querySelector('[data-chat-command="project:cursor:command:review"]');
 await slash('/new');await slash('/provider claude-code');
 checks.claudeProviderAvailable=document.querySelector('[data-provider="claude-code"]')?.getAttribute('aria-pressed')==='true';
 value(message(),'/skill');await wait(80);await until(()=>document.querySelector('[data-chat-command="user:shared:skill:project-tour"]'));checks.sharedWorkflowAvailableToClaude=!!document.querySelector('[data-chat-command="user:shared:skill:project-tour"]');
 document.querySelector('[data-chat-command="user:shared:skill:project-tour"]').click();await until(()=>document.querySelector('.selected-workflow'));
 value(message(),'Use the selected workflow with Claude Code.');await wait(40);document.querySelector('[aria-label="Start project agent"]').click();
 await until(()=>sent.filter(item=>item.type==='agent.spawn').length===2);
 spawn=sent.filter(item=>item.type==='agent.spawn')[1];
 checks.claudeUsesNativeHarness=spawn.spec.client==='claude-code'&&spawn.spec.profile==='build'&&spawn.spec.worktree===false;
 checks.noModelCalls=!sent.some(item=>item.type==='provider.generate');
 return {checks,commands:sent.map(item=>item.type)};
})()`;

const changeReview = `(async()=>{${setup}
 await showAgents();await freshChat();
 const sent=[],original=fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST')sent.push(JSON.parse(args[1].body));return original(...args);};
 const tabs=[...document.querySelectorAll('.telemetry-tabs button')];tabs.find(button=>button.textContent.includes('Changes')).click();
 await until(()=>document.querySelector('.change-diff pre'));
 checks.projectChangeList=!!document.querySelector('[role="listbox"][aria-label="Changed project files"]');
 checks.diffPreview= document.querySelector('.change-diff code').textContent.includes('Project conversation context');
 checks.relativePaths=[...document.querySelectorAll('.change-file-list button span')].every(node=>!node.textContent.includes('C:\\\\'));
 checks.copyReviewAvailable=!!document.querySelector('.change-diff button');
 document.querySelector('[aria-label="Privacy veil"]').click();await wait(120);
 const afterVeil=sent.length;await wait(1800);
 checks.veilHidesChanges=!document.querySelector('.change-file-list')&&!document.querySelector('.change-diff pre');
 checks.veilStopsGitReads=!sent.slice(afterVeil).some(item=>['world.changes','world.diff'].includes(item.type));
 document.querySelector('[aria-label="Privacy veil"]').click();await until(()=>document.querySelector('.change-diff pre'));
 checks.changesReturnAfterVeil=!!document.querySelector('.change-review');
 return {checks,commands:sent.map(item=>item.type)};
})()`;

const widgets = `(async()=>{${setup}
 const sent=[],original=fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST')sent.push(JSON.parse(args[1].body));return original(...args);};
 checks.lazyKnowledge=!sent.some(c=>c.type==='world.knowledge');
 document.querySelector('[aria-label="Open Brain widget"]').click();await until(()=>document.querySelector('[aria-label="Brain knowledge graph"]'));
 checks.brainNodes=document.querySelectorAll('[data-graph-node]').length===9;
 checks.brainLinks=document.querySelectorAll('.knowledge-edge').length===10;
 checks.loadedOnDemand=sent.filter(c=>c.type==='world.knowledge').length===1;
 const first=document.querySelector('[data-graph-node]');first.dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(70);
 checks.nodeSelected=first.getAttribute('data-selected')==='true'&&document.querySelector('[aria-label="Graph node details"]').textContent.includes('direct connections');
 value(document.querySelector('[aria-label="Search graph nodes"]'),'Architecture');await wait(80);
 checks.searchHighlights=[...document.querySelectorAll('[data-graph-node]')].filter(n=>n.style.opacity==='1').length===1;
 document.querySelector('[aria-label="Expand widget"]').click();await wait(70);checks.expansionWorks=document.querySelector('.project-map-widget').dataset.expanded==='true';
 document.querySelector('[aria-label="Graph node details"] .project-secondary').click();await showAgents();await freshChat();
 checks.graphContext=document.querySelector('.project-context').textContent.includes('brain/index.md');
 checks.chatCentered=!!document.querySelector('.agent-observatory')&&!document.querySelector('.project-map-widget');
 value(message(),'A draft between lenses');await wait(60);document.querySelector('[data-view="map"]').click();await wait(60);
 document.querySelector('[aria-label="Open structure widget"]').click();await until(()=>document.querySelector('[aria-label="Project structure graph"]'));
 checks.realStructure=document.querySelectorAll('[data-graph-node]').length===19&&document.querySelectorAll('.knowledge-edge').length===18;
 document.querySelector('[aria-label="Project structure graph"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(80);
 checks.escapeClosesWidgetOnly=!document.querySelector('.project-map-widget')&&!!surface();
 await showAgents();checks.draftAcrossViews=message().value==='A draft between lenses';
 document.querySelector('[data-view="map"]').click();await wait(60);document.querySelector('[aria-label="Open Brain widget"]').click();await until(()=>document.querySelector('[data-graph-node]'));
 document.querySelector('[aria-label="Privacy veil"]').click();await wait(100);const count=sent.length;await wait(2000);
 checks.veilRemovesGraph=!document.querySelector('[data-graph-node]')&&!document.querySelector('.project-map-widget');
 checks.veilStopsKnowledge=!sent.slice(count).some(c=>c.type==='world.knowledge');checks.noLaunches=!sent.some(c=>c.type==='agent.spawn');
 return {checks};
})()`;

const telemetry = `(async()=>{${setup}
 const world=Object.values(s().model.crafts).find(c=>c.childIds.length)?.worldId;
 if(world)value(document.querySelector('[aria-label="Explore project"]'),world);await wait(150);await showAgents();await freshChat();
 const id=document.querySelector('[aria-label="Explore project"]').value,nodes=Object.values(s().model.crafts).filter(c=>c.worldId===id);
 checks.completeTree=document.querySelectorAll('.agent-tree-row').length===nodes.length;
 const rows=[...document.querySelectorAll('.agent-tree-row')],deepest=rows.sort((a,b)=>Number(b.dataset.depth)-Number(a.dataset.depth))[0];deepest.click();await wait(200);
 checks.inspectAnyDepth=deepest.getAttribute('aria-pressed')==='true'&&!!document.querySelector('[aria-label="Selected agent details"]');
 checks.correctDepth=Number(deepest.dataset.depth)>0;
 const chat=message();checks.inspectKeepsDraft=!!chat;
 document.querySelectorAll('.telemetry-tabs button')[1].click();await wait(100);checks.liveTraceView=!!document.querySelector('[aria-label="Selected agent live trace"]');
 checks.traceHasStages=document.querySelectorAll('.agent-trace-row').length>0;
 [...document.querySelectorAll('.telemetry-tabs button')].find(button=>button.textContent.includes('Activity')).click();await wait(100);checks.activityView=!!document.querySelector('[aria-label="Project agent activity"]');
 document.querySelectorAll('.telemetry-tabs button')[0].click();await wait(100);checks.treeReturns=document.querySelectorAll('.agent-tree-row').length===nodes.length;
 document.querySelectorAll('.telemetry-tabs button')[1].click();await wait(100);
 return {checks};
})()`;

const markdownOutput = `(async()=>{${setup}
 const original=fetch,tick=String.fromCharCode(96),text=['## Result','','A **clear** answer with '+tick+'inline code'+tick+'.','','- First step','- Second step','','> Keep this note visible.','',tick.repeat(3)+'ts','const value = 42;',tick.repeat(3),'','| File | State |','| --- | --- |','| src/app.ts | Ready |','','<img src=x onerror=alert(1)>'].join(String.fromCharCode(10)),row={messageId:'fixture-markdown',at:Date.now(),role:'assistant',text,truncated:false};
 window.fetch=(...args)=>{try{if(args[1]?.method==='POST'&&JSON.parse(args[1].body).type==='craft.text')return Promise.resolve(new Response(JSON.stringify({ok:true,result:{available:true,rows:[row]}}),{status:200,headers:{'content-type':'application/json'}}));}catch{}return original(...args);};
 document.querySelector('[data-view="chat"]').click();await until(()=>document.querySelector('.agent-observatory'));await wait(700);
 checks.formattedHeading=!!document.querySelector('.message-heading');checks.formattedList=document.querySelectorAll('.project-message-body li').length===2;
 checks.codeAndTable=!!document.querySelector('.message-code pre code')&&!!document.querySelector('.message-table-wrap table');
 checks.copyResponse=!!document.querySelector('[aria-label="Copy assistant response"]')&&!!document.querySelector('[aria-label="Copy code block"]');
 checks.outputIsTextOnly=!document.querySelector('.project-message-body img')&&document.querySelector('.project-message-body').textContent.includes('<img src=x');
 return {checks};
})()`;

const restoresConversation = `(async()=>{${setup}
 const world=document.querySelector('[aria-label="Explore project"]').value;
 const expected=Object.values(s().model.crafts).filter(c=>c.worldId===world&&c.kind==='main'&&c.visible&&c.owned&&c.sessionId).sort((a,b)=>b.lastActiveAt-a.lastActiveAt)[0];
 await showAgents();
 checks.latestOwnedConversationRestored=!!expected&&document.querySelector('[aria-label="Project conversation"]').value===(expected.agentId||expected.id);
 checks.workspaceScopeShown=!!expected&&document.querySelector('.chat-workspace-context').textContent.includes(expected.worldName);
 checks.transcriptAreaReady=!!document.querySelector('.project-messages[role="log"]');
 return {checks};
})()`;

const sizing = `(async()=>{${setup}
 await showAgents();await freshChat();
 await Promise.all(surface().getAnimations().map(animation=>animation.finished));
 await wait(60);const compactHeight=message().getBoundingClientRect().height;
 checks.emptyEditorCompact=compactHeight<=60;
 const draft=Array.from({length:24},(_,i)=>'Draft line '+(i+1)).join(String.fromCharCode(10));value(message(),draft);await wait(100);
 const initial=surface().getBoundingClientRect(),initialEditor=message().getBoundingClientRect();
 checks.editorGrowsWithDraft=initialEditor.height>=110;
 document.querySelector('[aria-label="Maximize project window"]').click();await wait(100);
 const maximized=surface().getBoundingClientRect();
 checks.windowMaximizes=maximized.height>initial.height&&maximized.width>=initial.width&&maximized.top<=6;
 const widthBefore=document.querySelector('.project-chat').getBoundingClientRect().width;
 document.querySelector('[aria-label="Focus conversation"]').click();await wait(100);
 checks.telemetryHidden=getComputedStyle(document.querySelector('.project-telemetry-region')).display==='none';
 const focusedWidth=document.querySelector('.project-chat').getBoundingClientRect().width;
 checks.chatUsesSpace=innerWidth<=640?focusedWidth>=widthBefore:focusedWidth>widthBefore+200;
 document.querySelector('[aria-label="Expand text editor"]').click();await wait(100);
 checks.editorGrows=message().getBoundingClientRect().height>initialEditor.height*1.4;
 const send=document.querySelector('[aria-label="Start project agent"]');
 checks.sendVisible=send.getBoundingClientRect().bottom<maximized.bottom&&send.getBoundingClientRect().left>=maximized.left;
 checks.draftPreserved=message().value===draft;
 send.focus();send.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
 const visible=[...surface().querySelectorAll('button:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]'));
 checks.focusSkipsHiddenPanes=document.activeElement===visible[0];
 document.querySelector('[aria-label="Collapse text editor"]').click();await wait(80);
 checks.editorRestores=Math.abs(message().getBoundingClientRect().height-initialEditor.height)<2;
 document.querySelector('[aria-label="Show agent telemetry"]').click();await wait(80);
 checks.telemetryReturns=getComputedStyle(document.querySelector('.project-telemetry-region')).display!=='none';
 document.querySelector('[aria-label="Restore project window"]').click();await wait(100);
 const restored=surface().getBoundingClientRect();
 checks.windowRestores=Math.abs(restored.height-initial.height)<2;
 checks.draftAfterRestore=message().value===draft;
 checks.noPageOverflow=document.documentElement.scrollWidth<=innerWidth;
 document.querySelector('[aria-label="Maximize project window"]').click();document.querySelector('[aria-label="Focus conversation"]').click();document.querySelector('[aria-label="Expand text editor"]').click();await wait(150);
 return {checks,dimensions:{emptyEditorHeight:compactHeight,initial:initial.toJSON(),maximized:maximized.toJSON(),restored:restored.toJSON()}};
})()`;

const isolation = `(async()=>{${setup}
 const picker=()=>document.querySelector('[aria-label="Explore project"]'),ids=[...picker().options].map(o=>o.value),first=picker().value,second=ids.find(id=>id!==first),third=ids.find(id=>id!==first&&id!==second);
 const tags={[first]:'alpha',[second]:'beta',[third]:'gamma'},sent=[],original=fetch;
 let lateSurvey=false,lateKnowledge=false,copied='';
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
 window.fetch=async(...args)=>{
  const body=args[1]?.method==='POST'?JSON.parse(args[1].body):null;if(body)sent.push(body);
  if(body?.type==='world.survey'){
   if(body.worldId===third){lateSurvey=true;await wait(650);}
   const tag=tags[body.worldId];return new Response(JSON.stringify({ok:true,result:{files:33,complete:true,languages:[{name:tag+' language',files:33}],regions:Array.from({length:15},(_,i)=>({path:tag+'/area-'+i,name:tag+' '+i,kind:i%2?'docs':'source',files:i+1,entries:[tag+'/area-'+i+'/README.md']}))}}),{headers:{'content-type':'application/json'}});
  }
  if(body?.type==='world.knowledge'){
   if(body.worldId===first){lateKnowledge=true;await wait(650);}
   const tag=tags[body.worldId];return new Response(JSON.stringify({ok:true,result:{nodes:[{id:tag+'/brain.md',title:tag+' knowledge',folder:tag}],edges:[],complete:true}}),{headers:{'content-type':'application/json'}});
  }
  return original(...args);
 };
 document.querySelector('[aria-label="Resurvey project"]').click();await until(()=>document.querySelector('[data-territory="alpha/area-14"]'));
 checks.completeDirectory=document.querySelectorAll('[data-territory]').length===15;
 document.querySelector('[data-territory="alpha/area-14"]').click();await wait(60);
 checks.offMapFolderReachable=!!document.querySelector('.map-region[data-region="alpha/area-14"][data-selected="true"]');
 document.querySelector('[aria-label="Copy territory path"]').click();await wait(60);checks.copyRelativePath=copied==='alpha/area-14';
 value(document.querySelector('[aria-label="Search project territories"]'),'area-14');await wait(60);checks.searchOwnFolders=document.querySelectorAll('[data-territory]').length===1;
 document.querySelector('[aria-label="Discuss selected area"]').click();await showAgents();await freshChat();checks.territoryHandoff=document.querySelector('.project-context').textContent.includes('alpha/area-14');
 document.querySelector('[data-view="map"]').click();await wait(60);
 document.querySelector('[aria-label="Open Brain widget"]').click();await until(()=>lateKnowledge);
 value(picker(),second);await until(()=>document.querySelector('[data-territory="beta/area-0"]'));
 checks.switchClearsLens=!document.querySelector('.project-map-widget');checks.switchClearsContext=!document.querySelector('[aria-label="Selected project area"]');
 checks.onlySecondProject=!document.querySelector('.planet-surface').textContent.includes('alpha')&&document.querySelector('[aria-label="Project languages"]').textContent.includes('beta language');
 document.querySelector('[aria-label="Open Brain widget"]').click();await until(()=>document.querySelector('[data-graph-node="beta/brain.md"]'));await wait(750);
 checks.lateKnowledgeIgnored=document.querySelector('[aria-label="Brain widget"]').textContent.includes('beta knowledge')&&!document.querySelector('[data-graph-node="alpha/brain.md"]');
 document.querySelector('[aria-label="Close map widget"]').click();await wait(50);
 value(picker(),third);await until(()=>lateSurvey);value(picker(),second);await until(()=>document.querySelector('[data-territory="beta/area-0"]'));await wait(750);
 checks.lateSurveyIgnored=document.querySelector('[data-project-scope]').dataset.projectScope===second&&[...document.querySelectorAll('[data-territory]')].every(row=>row.dataset.territory.startsWith('beta/'));
 document.querySelector('[aria-label="Open structure widget"]').click();await until(()=>document.querySelector('[data-graph-node="folder:beta/area-0"]'));
 checks.structureIsLocal=[...document.querySelectorAll('[data-graph-node]')].every(row=>row.dataset.graphNode==='.'||row.dataset.graphNode.includes('beta/'));
 document.querySelector('[aria-label="Close map widget"]').click();value(document.querySelector('[aria-label="Search project territories"]'),'beta');await wait(50);
 document.querySelector('[aria-label="Privacy veil"]').click();await wait(100);const count=sent.length;await wait(300);
 checks.veilHidesSearch=document.querySelector('[aria-label="Search project territories"]').value==='';
 checks.veilHidesProjectData=!document.querySelector('.planet-surface').textContent.includes('beta/')&&!document.querySelector('[data-map-world]')&&!document.querySelector('[data-local-agent]');
 checks.veilStopsProjectReads=!sent.slice(count).some(c=>['world.survey','world.knowledge'].includes(c.type));
 checks.noAutomaticAgent=sent.every(c=>c.type!=='agent.spawn');
 return {checks};
})()`;

const minimal = `(async()=>{${setup}
 await showAgents();await freshChat();await wait(100);
 const chat=document.querySelector('.project-chat').getBoundingClientRect(),editor=message().getBoundingClientRect(),composer=document.querySelector('.quiet-composer').getBoundingClientRect(),history=document.querySelector('.project-messages').getBoundingClientRect();
 checks.compactHeader=document.querySelector('.project-chat-head').getBoundingClientRect().height<70;
 checks.compactEmptyEditor=editor.height>=38&&editor.height<=60;
 checks.oneWritingSurface=composer.height<150;
 checks.spaceForConversation=history.height>chat.height*.55;
 checks.noConfigurationCards=!document.querySelector('.project-provider-picker')&&!document.querySelector('.project-prompts')&&!document.querySelector('[aria-label="Agent model"]')&&!document.querySelector('[aria-label="Agent mode"]');
 checks.editorInView=editor.top>=chat.top&&editor.bottom<=chat.bottom;
 checks.noPageOverflow=document.documentElement.scrollWidth<=innerWidth;
 return {checks,dimensions:{chatHeight:chat.height,editorHeight:editor.height,composerHeight:composer.height,historyHeight:history.height}};
})()`;

const slashCommands = `(async()=>{${setup}
 const area=document.querySelector('.map-region').dataset.region;document.querySelector('.map-region').dispatchEvent(new MouseEvent('click',{bubbles:true}));await showAgents();await freshChat();
 const sent=[],original=fetch;window.fetch=(...args)=>{if(args[1]?.method==='POST')sent.push(JSON.parse(args[1].body));return original(...args);};
 value(message(),'/');await wait(80);checks.menuOpens=!!document.querySelector('[aria-label="Chat command menu"]');
 press('ArrowDown');await wait(50);checks.keyboardSelection=document.querySelector('[data-chat-command="model"]').getAttribute('aria-selected')==='true';
 press('Tab');await wait(60);checks.tabOpensModel=!!document.querySelector('[data-chat-command="fixture-codex"]');
 press('ArrowDown');await wait(50);press('Enter');await wait(60);checks.keyboardChoosesModel=document.querySelector('[aria-label="Choose agent model"]').textContent!=='Default'&&message().value==='';
 await slash('/plan');checks.modeViaAlias=document.querySelector('[aria-label="Choose agent mode"]').textContent==='Plan';
 await slash('/provider cursor');await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));checks.providerViaCommand=!!document.querySelector('[data-provider="cursor"]');
 checks.providerResetsModel=document.querySelector('[aria-label="Choose agent model"]').textContent==='Default';
 await slash('/model fixture-cursor');checks.modelViaCommand=document.querySelector('[aria-label="Choose agent model"]').textContent!=='Default';
 await slash('/mode read'+String.fromCharCode(10)+'A draft after configuration');checks.commandKeepsFollowingDraft=message().value==='A draft after configuration'&&document.querySelector('[aria-label="Choose agent mode"]').textContent==='Read only';
 document.querySelector('[aria-label="Choose agent provider"]').click();await wait(60);document.querySelector('[data-chat-command="codex"]').click();await until(()=>document.querySelector('.quiet-chat[data-provider-ready="true"]'));checks.pointerKeepsDraft=message().value==='A draft after configuration';
 await slash('/focus'+String.fromCharCode(10)+'A focus draft');checks.focusViaCommand=document.querySelector('.project-telemetry-region').hidden&&message().value==='A focus draft';await slash('/focus');
 const compactHeight=message().getBoundingClientRect().height;await slash('/expand'+String.fromCharCode(10)+'A longer writing space');checks.expandViaCommand=message().getBoundingClientRect().height>compactHeight*1.5;await slash('/expand');
 value(message(),'/');await wait(60);const all=document.querySelector('[aria-label="All chat commands"]');all.focus();all.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(60);checks.escapeClosesMenuOnly=!document.querySelector('[aria-label="Chat command menu"]')&&!!surface();
 await slash('/context');checks.contextCleared=!document.querySelector('.project-context');
 await slash('/unrecognized-command');checks.unknownStaysLocal=!!document.querySelector('.chat-command-empty')&&sent.every(c=>!['agent.spawn','agent.send'].includes(c.type));
 value(message(),'A retained draft');await wait(50);document.querySelector('[aria-label="Open chat commands"]').click();await wait(60);checks.manualMenuKeepsDraft=message().value==='A retained draft';
 document.querySelector('[aria-label="Privacy veil"]').click();await wait(80);checks.veilClosesCommands=!document.querySelector('[aria-label="Chat command menu"]')&&message().value===''&&message().disabled;
 document.querySelector('[aria-label="Privacy veil"]').click();await until(()=>!message().disabled);checks.veilRestoresDraft=message().value==='A retained draft';
 await slash('/model fixture-codex');await slash('/plan');value(message(),'Exercise the compact chat');await wait(50);document.querySelector('[aria-label="Open chat commands"]').click();await wait(50);document.querySelector('[aria-label="Start project agent"]').click();await until(()=>document.querySelector('[aria-label="Project conversation"]').value);
 const spawn=sent.find(c=>c.type==='agent.spawn'),agentId=document.querySelector('[aria-label="Project conversation"]').value;
 checks.settingsReachLaunch=spawn.spec.client==='codex'&&spawn.spec.model==='fixture-codex'&&spawn.spec.mode==='plan-first'&&!promptText(spawn.spec.prompt).startsWith('/');
 await original('/api/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'fixture.control',action:'play'})});await until(()=>s().fleet.managed[agentId]?.sessionId);
 await slash('/stop');await until(()=>s().view.overlays.some(o=>o.id==='stop-confirm'));checks.stopRequiresConfirmation=sent.every(c=>c.type!=='agent.stop');
 key('Escape');await wait(100);checks.cancelStopKeepsChat=!!surface()&&!s().view.overlays.some(o=>o.id==='stop-confirm');
 value(message(),'//review these changes');await wait(60);document.querySelector('[aria-label="Send message"]').click();await until(()=>sent.some(c=>c.type==='agent.send'));checks.literalSlashForwarded=promptText(sent.find(c=>c.type==='agent.send').text)==='/review these changes';
 await until(()=>!message().disabled);await slash('/new');checks.newCommandKeepsProject=document.querySelector('[aria-label="Project conversation"]').value===''&&document.querySelector('[aria-label="Explore project"]').value===spawn.spec.worldId;
 checks.onlyExplicitLaunch=sent.filter(c=>c.type==='agent.spawn').length===1;
 value(message(),'/');await wait(100);
 return {checks};
})()`;

const cases = [
 { name: 'surface-wide', viewport: '1600x1000', eval: layout },
 { name: 'surface-desktop', viewport: '1280x800', eval: layout },
 { name: 'surface-compact', viewport: '1024x768', eval: layout },
 { name: 'surface-mobile', viewport: '390x844', eval: layout },
 { name: 'conversation', viewport: '1600x1000', eval: interaction },
 { name: 'latest-conversation-restored', viewport: '1600x1000', eval: restoresConversation },
 { name: 'clients-and-approvals', viewport: '1280x800', eval: clients },
 { name: 'launch-retries', viewport: '1280x800', eval: refusals },
 { name: 'surface-entrypoints', viewport: '1600x1000', eval: entrypoints },
 { name: 'native-provider-selection', viewport: '1600x1000', eval: providers },
 { name: 'installed-workflow-picker', viewport: '1600x1000', eval: workflows },
 { name: 'project-change-review', viewport: '1600x1000', eval: changeReview },
 { name: 'brain-and-structure-widgets', viewport: '1600x1000', eval: widgets },
 { name: 'agent-hierarchy', viewport: '1600x1000', eval: telemetry },
 { name: 'chat-markdown-output', viewport: '1600x1000', eval: markdownOutput },
 { name: 'project-data-isolation', viewport: '1600x1000', eval: isolation },
 ...['1600x1000','1024x768','390x844'].map(viewport=>({name:'minimal-chat-'+viewport,viewport,eval:minimal})),
 { name: 'chat-slash-commands', viewport: '1600x1000', eval: slashCommands },
 ...['390x844','1024x600'].map(viewport=>({ name: viewport.startsWith('390') ? 'chat-commands-mobile' : 'chat-commands-short', viewport, eval: `(async()=>{${setup}
  await showAgents();await freshChat();value(message(),'/');await wait(120);
  const box=document.querySelector('[aria-label="Chat command menu"]').getBoundingClientRect();
  checks.paletteFits=box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
  checks.activeOptionExists=!!document.getElementById(message().getAttribute('aria-activedescendant'));
  checks.noOverflow=document.documentElement.scrollWidth<=innerWidth;
  await slash('/expand');value(message(),'/');await wait(100);const expanded=document.querySelector('[aria-label="Chat command menu"]').getBoundingClientRect();
  checks.expandedPaletteFits=expanded.left>=0&&expanded.top>=0&&expanded.right<=innerWidth&&expanded.bottom<=innerHeight;
  return {checks};
 })()` })),
 ...['1600x1000', '1024x768', '390x844'].map(viewport=>({name:'agent-sizing-'+viewport,viewport,eval:sizing})),
 ...['1600x1000', '390x844'].map(viewport => ({ name: viewport.startsWith('390') ? 'brain-mobile' : 'brain-desktop', viewport, eval: `(async()=>{${setup}
  const map=document.querySelector('.project-map-stage'),trigger=document.querySelector('[aria-label="Open Brain widget"]');
  if(innerWidth<=760){trigger.scrollIntoView({block:'center'});trigger.focus();await wait(80);checks.openedFromScrolledInspector=map.scrollTop>0;}
  document.querySelector('[aria-label="Open Brain widget"]').click();await until(()=>document.querySelector('[data-graph-node]'));
  document.querySelector('[data-graph-node]').dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(200);
  const box=document.querySelector('.project-map-widget').getBoundingClientRect(),canvas=document.querySelector('.knowledge-canvas').getBoundingClientRect();
  checks.widgetFits=box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
  checks.graphHasSpace=canvas.width>200&&canvas.height>160;
  checks.inspectorAvailable=!!document.querySelector('[aria-label="Graph node details"] .project-secondary');
  checks.noOverflow=document.documentElement.scrollWidth<=innerWidth;
  return {checks};
 })()` })),
];
const results = [];
for (const item of cases) {
 if (options.only && !options.only.split(',').includes(item.name)) continue;
 const inspected = `(${item.eval}).catch(error=>({checks:{completed:false},diagnostic:{error:String(error),link:window.__naos.getState().link.status,overlays:window.__naos.getState().view.overlays.map(o=>o.id),veil:window.__naos.getState().view.settings.veil,map:document.querySelector('.project-map-state')?.textContent}}))`;
 const warm = Number(item.viewport.split('x')[0]) >= 1024 ? ['--mounted', '--settled'] : [];
 const result = await run(process.execPath, ['scripts/shot.mjs', '--name', item.name, '--out', out, '--viewport', item.viewport, '--dpr', '1.5', '--seek', '60', '--pause', '--wait', '1800', ...warm, '--eval', inspected], { cwd: repo, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).catch((error) => { throw new Error(item.name + ': ' + error.stderr); });
 const report = JSON.parse(result.stdout); results.push(report);
 if (report.eval.diagnostic) console.log(JSON.stringify(report.eval.diagnostic));
 assert.deepEqual(report.consoleErrors, [], item.name + ': console');
 assert.deepEqual(report.pageErrors, [], item.name + ': page');
 assert.deepEqual(report.failedRequests, [], item.name + ': requests');
 for (const [name, passed] of Object.entries(report.eval.checks)) assert.equal(passed, true, item.name + ': ' + name);
 console.log('PASS ' + item.name + ': ' + Object.keys(report.eval.checks).join(', '));
}
const review = cases.flatMap((item) => { const file = path.join(out, item.name + '.json'); return existsSync(file) ? [JSON.parse(readFileSync(file, 'utf8'))] : []; });
writeFileSync(path.join(out, 'review.json'), JSON.stringify(review, null, 2));
