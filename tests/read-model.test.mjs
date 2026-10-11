import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadModel,readOwnedActor,canOwnActor} from '../scripts/adapters/cpr-read-model.mjs';
import {scalarNumber} from '../scripts/core/lifecycle.mjs';
import {renderHUD,safeImageSource} from '../scripts/ui/render.mjs';
import {CAPABILITIES,normalizePreferences,OPERATION_CATALOG} from '../scripts/core/contracts.mjs';
const PLAYER={id:'player',isGM:false},GM={id:'gm',isGM:true},SYS={id:'cyberpunk-red-core',version:'unverified-test-shape'};
export const makeActor=(id,hp=42,owner=true)=>({id,uuid:`Actor.${id}`,name:`Actor ${id}`,type:'character',img:'worlds/test/portrait.webp',testUserPermission:(user,level)=>level==='OWNER'&&(owner||user.isGM),system:{derivedStats:{hp:{value:hp,max:50},currentWoundState:'lightlyWounded'},externalData:{currentArmorHead:{value:11,max:11},currentArmorBody:{value:10,max:11}},stats:{luck:{value:4,max:6}},weapons:{equipped:[{id:'gun',uuid:`Actor.${id}.Item.gun`,name:'Very long weapon name · Штурмовая винтовка',type:'weapon',system:{damage:'5d6',rof:1,isRanged:true,magazine:{value:0,max:25},loadedAmmo:{name:'Basic'}}}]}},statuses:new Set(['prone'])});
export const makeToken=(id,actor,{hidden=false,visible=true,scene='s1'}={})=>({visible,actor,document:{id,uuid:`Scene.${scene}.Token.${id}`,name:`Token ${id}`,hidden,parent:{id:scene},texture:{src:`worlds/test/${id}.webp`}}});
const makeCombat=(tokens,turn=0)=>{const turns=tokens.map((token,index)=>({id:`c${index}`,uuid:`Combat.battle.Combatant.c${index}`,token:token.document,actor:token.actor,initiative:20-index,hidden:token.document.hidden,defeated:false}));return {uuid:'Combat.battle',scene:{id:'s1'},round:2,started:true,turn,turns,get combatant(){return this.turns[this.turn]??null;},get nextCombatant(){return this.turns.length?this.turns[(this.turn+1)%this.turns.length]:null;}};};
const build=(tokens,overrides={})=>createReadModel({combat:makeCombat(tokens),controlledTokens:[tokens[0]],targetTokens:tokens.slice(1,2),sceneTokens:tokens,sceneId:'s1',user:PLAYER,system:SYS,...overrides});

test('selected Token.actor, current Combatant and target remain three independent identities',()=>{
 const a=makeToken('alpha',makeActor('alpha')),b=makeToken('beta',makeActor('beta')),c=makeToken('enemy',makeActor('enemy',30,false));const combat=makeCombat([a,b,c],1);
 const before=build([a,b,c],{combat,targetTokens:[c]});
 assert.equal(before.selected.tokenUuid,a.document.uuid);assert.equal(before.combat.currentId,'c1');assert.equal(before.targets[0].tokenUuid,c.document.uuid);
 const after=build([a,b,c],{combat,controlledTokens:[b],targetTokens:[c]});
 assert.equal(after.selected.tokenUuid,b.document.uuid);assert.equal(after.combat.currentId,before.combat.currentId);assert.equal(after.targets[0].tokenUuid,before.targets[0].tokenUuid);
});
test('two synthetic actors sharing a base id retain token identity and per-token resources',()=>{
 const first=makeToken('first',makeActor('same',11)),second=makeToken('second',makeActor('same',27));first.actor.uuid=`${first.document.uuid}.Actor.same`;second.actor.uuid=`${second.document.uuid}.Actor.same`;
 const m=build([first,second],{controlledTokens:[first,second],selectedTokenUuid:first.document.uuid});
 assert.equal(m.queue.length,2);assert.notEqual(m.queue[0].tokenUuid,m.queue[1].tokenUuid);assert.equal(m.selected.detail.resources.hp.value,11);assert.equal(m.queue[1].selected,false);
 const n=build([first,second],{controlledTokens:[second]});assert.equal(n.selected.detail.resources.hp.value,27);
});
test('hidden current participant does not leak id, name, count or a false next visible participant',()=>{
 const own=makeToken('own',makeActor('own')),hidden=makeToken('SECRET_TOKEN',makeActor('SECRET_ACTOR',123,false),{hidden:true}),visible=makeToken('visible',makeActor('visible',30,false));
 const m=build([own,hidden,visible],{combat:makeCombat([own,hidden,visible],0),targetTokens:[hidden,visible]});
 assert.equal(m.queue.length,2);assert.equal(m.combat.nextId,null);assert.equal(m.targets.length,1);assert.equal(JSON.stringify(m).includes('SECRET'),false);assert.equal(m.queue.some(row=>row.next),false);
 const h=build([own,hidden,visible],{combat:makeCombat([own,hidden,visible],1),targetTokens:[hidden]});assert.equal(h.combat.currentId,null);assert.equal(JSON.stringify(h).includes('SECRET'),false);
});
test('resources and Actor UUID do not escape a nonowned visible target',()=>{
 const own=makeToken('own',makeActor('own'));const npc=makeActor('npc',9876,false);Object.defineProperty(npc,'system',{get(){throw new Error('PRIVATE system read');}});const target=makeToken('npc',npc);
 const m=build([own,target]);assert.equal(m.targets[0].detail,null);assert.equal(m.targets[0].actorUuid,null);assert.equal(m.queue[1].actorUuid,null);assert.equal(JSON.stringify(m).includes('9876'),false);
});
test('missing permission method and OBSERVER/LIMITED permission fail closed',()=>{
 for(const actor of [{system:{derivedStats:{hp:{value:999}}}},{testUserPermission:(_u,level)=>level==='OBSERVER'}]) {assert.equal(canOwnActor(actor,PLAYER),false);assert.equal(readOwnedActor(actor,PLAYER,SYS),null);}
});
test('GM sees hidden participants and permitted target details',()=>{
 const own=makeToken('own',makeActor('own')),hidden=makeToken('hidden',makeActor('hidden',13,false),{hidden:true,visible:false});
 const m=build([own,hidden],{user:GM,targetTokens:[hidden]});assert.equal(m.queue.length,2);assert.equal(m.queue[1].hidden,true);assert.equal(m.targets[0].detail.resources.hp.value,13);
});
test('stale targets from another scene, hidden and nonvisible tokens are filtered',()=>{
 const own=makeToken('own',makeActor('own')),other=makeToken('other',makeActor('other'),{scene:'s2'}),dark=makeToken('dark',makeActor('dark'),{visible:false}),hidden=makeToken('hidden',makeActor('hidden'),{hidden:true});
 const m=build([own,other,dark,hidden],{controlledTokens:[other,dark,hidden],targetTokens:[other,dark,hidden]});assert.equal(m.selected,null);assert.deepEqual(m.targets,[]);
});
test('zero differs from missing resources or malformed numeric data',()=>{
 assert.equal(scalarNumber(0),0);for(const v of [null,undefined,'',true,{},NaN,Infinity,'not a number'])assert.equal(scalarNumber(v),null);
 const actor=makeActor('own',0);delete actor.system.externalData.currentArmorHead;
 const m=readOwnedActor(actor,PLAYER,SYS);assert.equal(m.resources.hp.value,0);assert.equal(m.resources.head.value,null);assert.equal(m.weapons[0].magazine.value,0);assert.equal(m.resources.shield.value,null);
});
test('wrong system does not even read CPR fields and reports unsupported',()=>{
 const actor=makeActor('own');Object.defineProperty(actor,'system',{get(){throw new Error('Wrong system read');}});
 const m=readOwnedActor(actor,PLAYER,{id:'other',version:'1'});assert.equal(m.supported,false);assert.equal(m.resources,null);assert.deepEqual(m.weapons,[]);
});
test('empty combat, no selected token and partial actor data stay readable',()=>{
 const m=createReadModel({user:PLAYER,system:SYS,sceneId:'s1'});assert.deepEqual(m.queue,[]);assert.equal(m.selected,null);assert.equal(m.combat,null);
 const actor={id:'partial',uuid:'Actor.partial',testUserPermission:()=>true};const d=readOwnedActor(actor,PLAYER,SYS);assert.equal(d.resources.hp.value,null);assert.deepEqual(d.weapons,[]);
 assert.match(renderHUD(m,normalizePreferences()),/Выберите свой токен/);
});
test('GM queue keeps native actor-only/manual combatants without token control',()=>{
 const actor=makeActor('manual');const row={id:'manual',uuid:'Combat.battle.Combatant.manual',actor,name:'Manual entry',initiative:11,hidden:false};const combat={uuid:'Combat.battle',turns:[row],turn:0,combatant:row,round:1};
 const m=createReadModel({user:GM,system:SYS,combat,sceneId:'s1',sceneTokens:[]});assert.equal(m.queue.length,1);assert.equal(m.combat.currentId,'manual');assert.equal(m.queue[0].own,false);assert.equal(m.queue[0].unavailableToken,true);
});
test('read-model creation leaves native resources, turns and targets untouched',()=>{
 const tokens=[makeToken('own',makeActor('own')),makeToken('npc',makeActor('npc',10,false))];const combat=makeCombat(tokens),targets=new Set([tokens[1]]);const before=JSON.stringify({tokens,combat,targets:[...targets]});
 for(let i=0;i<5;i++)build(tokens,{combat,targetTokens:targets});assert.equal(JSON.stringify({tokens,combat,targets:[...targets]}),before);
});
test('HTML escapes document names and blocks executable portrait sources',()=>{
 const token=makeToken('own',makeActor('own'));token.document.name='<img src=x onerror=alert(1)>';token.document.texture.src='javascript:alert(2)';const html=renderHUD(build([token]),normalizePreferences());
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/src="javascript:/);for(const src of ['data:text/html,x','vbscript:x','file:///x','//tracker.example/x','java\nscript:x'])assert.equal(safeImageSource(src),null);
 assert.equal(safeImageSource('worlds/test/portrait.webp'),'worlds/test/portrait.webp');
});
test('capabilities and operation catalog do not expose a mutating game operation',()=>{
 for(const key of ['nativeRoll','damageApply','ammoChange','nextTurn','netAutomation','worldSettings','distributedExecution'])assert.equal(CAPABILITIES[key],false);
 assert.equal(CAPABILITIES.attackPrepare,true);const preview=OPERATION_CATALOG.find(op=>op.id==='attack.preview');assert.ok(preview);assert.deepEqual(preview.mutates,[]);assert.equal(OPERATION_CATALOG.length,8);assert.equal(OPERATION_CATALOG.filter(row=>row.id.startsWith('read.')).every(row=>row.mutates.length===0),true);
 const prefs=normalizePreferences({scale:1000,dock:'server',collapsed:1});assert.deepEqual(prefs,{compact:false,collapsed:false,scale:1,dock:'right',reduced:false});
});

test('next participant follows native getter and never invents a modulo fallback',()=>{
 const tokens=[makeToken('a',makeActor('a')),makeToken('b',makeActor('b')),makeToken('c',makeActor('c'))];const combat=makeCombat(tokens);
 Object.defineProperty(combat,'nextCombatant',{configurable:true,get(){return this.turns[2];}});
 const model=build(tokens,{combat});assert.equal(model.combat.nextId,'c2');assert.equal(model.queue[1].next,false);
 delete combat.nextCombatant;const unavailable=build(tokens,{combat});assert.equal(unavailable.combat.nextId,null);
});

test('a hidden Combatant on a visible Token stays outside the player queue',()=>{
 const tokens=[makeToken('own',makeActor('own')),makeToken('public-token',makeActor('npc',30,false))],combat=makeCombat(tokens,1);combat.turns[1].hidden=true;
 const m=build(tokens,{combat,targetTokens:[]});assert.equal(m.queue.length,1);assert.equal(m.combat.currentId,null);assert.equal(m.queue.some(row=>row.id==='c1'),false);
});
test('linked tokens sharing one Actor remain separate combatants',()=>{
 const actor=makeActor('linked'),a=makeToken('a',actor),b=makeToken('b',actor);const m=build([a,b],{controlledTokens:[a]});
 assert.equal(m.queue.length,2);assert.equal(m.queue[0].actorUuid,m.queue[1].actorUuid);assert.equal(m.queue.filter(row=>row.selected).length,1);
});
