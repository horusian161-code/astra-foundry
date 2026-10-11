import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeActionPort,NATIVE_ACTION_STUDY_PROFILES} from '../scripts/adapters/native-action-port.mjs';
const request=(operation='weapon.attack')=>operation==='damage.apply'?{operation,tokenUuid:'Scene.lab.Token.choom'}:
  {operation,tokenUuid:'Scene.lab.Token.choom',weaponId:'rifle',...(operation==='weapon.attack'?{mode:'single'}:{})};
function fixture() {
  const calls={permissions:0,render:0,gameplay:0};
  const actor={uuid:'Scene.lab.Token.choom.Actor.actor',name:'Чум',testUserPermission:(_user,level)=>{calls.permissions++;return level==='OWNER';},
    sheet:{render:()=>{calls.render++;}},items:new Map(),_applyDamage:()=>{calls.gameplay++;}};
  const item={id:'rifle',parent:actor,type:'weapon',createRoll:()=>{calls.gameplay++;},reload:()=>{calls.gameplay++;},confirmRoll:()=>{calls.gameplay++;}};
  actor.items.set('rifle',item);
  const token={document:{uuid:'Scene.lab.Token.choom',parent:{id:'lab'},hidden:false,name:'Чум'},actor,visible:true};
  const user={id:'player',isGM:false};
  const state={context:{token,user,sceneId:'lab'},runtime:{profileId:'cpr-v0.89.2-study',systemId:'cyberpunk-red-core',systemVersion:'v0.89.2',foundryGeneration:12,foundryBuild:'343',worldId:'redline-lab',userId:'player'}};
  const port=new NativeActionPort({resolveCurrentSelection:async()=>state.context,getRuntimeProfile:async()=>state.runtime});
  return {state,actor,item,calls,port,user,token};
}
test('default native port is blocked and all shipped profiles are non-executable',async()=>{
  const result=await new NativeActionPort().prepare(request());assert.equal(result.status,'blocked');assert.equal(result.reason.code,'no-selection');
  assert.equal(result.capabilities.nativeRoll,false);assert.equal(result.capabilities.damageApply,false);
  assert.ok(Object.isFrozen(NATIVE_ACTION_STUDY_PROFILES));
  assert.ok(NATIVE_ACTION_STUDY_PROFILES.every(p=>Object.isFrozen(p)&&!p.executable&&!p.liveAccepted));
});
test('source-study profile and present native methods cannot activate attacks, reload or damage',async()=>{
  const {port,calls}=fixture();
  for(const operation of ['weapon.attack','weapon.reload','damage.apply']) {
    const result=await port.execute(request(operation));assert.equal(result.reason.code,'unsupported-native-api');
    assert.equal(result.verification.publicGameplayAPI,false);assert.equal(result.runtime.liveAccepted,false);
    assert.equal(result.fallback.available,true);assert.equal(result.capabilities.nativeRoll,false);
  }
  assert.equal(calls.gameplay,0);assert.equal(calls.render,0);
});
test('request-supplied actor, provider, permission and certification assertions are rejected before providers run',async()=>{
  let calls=0;const port=new NativeActionPort({resolveCurrentSelection:()=>{calls++;return null;},getRuntimeProfile:()=>{calls++;return null;}});
  for(const extra of [{owner:true},{actorUuid:'Actor.other'},{verified:true},{profileId:'approved'},{getRuntimeProfile:'hack'},{damage:99}]) {
    const result=await port.execute({...request(),...extra});assert.equal(result.reason.code,'invalid-input');
  }
  assert.equal(calls,0);
});
test('provider-supplied liveAccepted flags still do not unlock a compiled source-study profile',async()=>{
  const {state,port,calls}=fixture();state.runtime.liveAccepted=true;state.runtime.executable=true;
  const result=await port.execute(request());assert.equal(result.reason.code,'unsupported-native-api');
  assert.equal(result.runtime.executable,false);assert.equal(result.runtime.liveAccepted,false);assert.equal(calls.gameplay,0);
});
test('bounded input rejects accessors/functions/arrays/unknown operations without reading getters',async()=>{
  let reads=0;const args=request();Object.defineProperty(args,'weaponId',{enumerable:true,get(){reads++;return 'rifle';}});
  const {port}=fixture();
  for(const input of [args,{...request(),mode:()=>{}},[],null,{operation:'actor.arbitrary'}, {...request(),weaponId:'r'.repeat(200)}, {...request(),tokenUuid:'Actor.foreign'}])
    assert.equal((await port.prepare(input)).reason.code,'invalid-input');
  assert.equal(reads,0);
});
test('unsupported fire modes and damage payloads cannot reach any native entrypoint',async()=>{
  const {port,calls}=fixture();
  for(const mode of ['aimed','autofire','suppressive','damage'])assert.equal((await port.prepare({...request(),mode})).reason.code,'invalid-input');
  assert.equal((await port.prepare({...request('damage.apply'),weaponId:'rifle'})).reason.code,'invalid-input');
  assert.equal((await port.prepare({...request('weapon.reload'),mode:'single'})).reason.code,'invalid-input');
  assert.equal(calls.gameplay,0);
});
test('missing/current token identity and off-scene token fail closed',async()=>{
  const {state,token,port}=fixture();state.context=null;assert.equal((await port.prepare(request())).reason.code,'no-selection');
  state.context={token,user:{id:'player'},sceneId:'lab'};
  token.document.uuid='Scene.lab.Token.other';assert.equal((await port.prepare(request())).reason.code,'stale-selection');
  token.document.uuid='Scene.lab.Token.choom';token.document.parent.id='other';assert.equal((await port.prepare(request())).reason.code,'wrong-scene');
});
test('hidden/invisible selection does not return actor or item identity',async()=>{
  const {token,port}=fixture();token.document.hidden=true;
  for(const op of ['prepare','execute','openFallback']) {const result=await port[op](request());assert.equal(result.reason.code,'hidden-selection');assert.ok(!('subject' in result));}
  token.document.hidden=false;token.visible=false;assert.equal((await port.prepare(request())).reason.code,'hidden-selection');
});
test('OWNER is required and rechecked on every attempt, GM bypass applies only to current subject',async()=>{
  const {actor,user,port,calls}=fixture();actor.testUserPermission=()=>false;
  assert.equal((await port.prepare(request())).reason.code,'rights');assert.equal((await port.openFallback(request())).reason.code,'rights');assert.equal(calls.render,0);
  user.isGM=true;assert.equal((await port.prepare(request())).reason.code,'unsupported-native-api');
  assert.equal((await port.prepare({...request(),tokenUuid:'Scene.lab.Token.foreign'})).reason.code,'stale-selection');
});
test('permission errors are blocked and not treated as ownership',async()=>{
  const {actor,port}=fixture();actor.testUserPermission=()=>{throw new Error('secret error');};
  const result=await port.execute(request());assert.equal(result.reason.code,'rights');assert.ok(!JSON.stringify(result).includes('secret error'));
});
test('world/foreign/stale item references cannot resolve against another collection',async()=>{
  const {actor,item,port}=fixture();actor.items.delete('rifle');assert.equal((await port.prepare(request())).reason.code,'item-missing');
  actor.items.set('rifle',item);item.parent={uuid:'Actor.foreign'};assert.equal((await port.prepare(request())).reason.code,'item-missing');
  item.parent=actor;item.type='cyberware';assert.equal((await port.prepare(request())).reason.code,'item-not-weapon');
});
test('unverified or mismatched runtime data is explicit instead of semver-range compatibility',async()=>{
  for(const change of [r=>r.profileId='cpr-latest',r=>r.systemVersion='v0.89.3',r=>r.systemVersion='0.89.2',r=>r.systemId='dnd5e',r=>r.userId='other']) {
    const {state,port}=fixture();change(state.runtime);assert.equal((await port.prepare(request())).reason.code,'profile-mismatch');
  }
  for(const change of [r=>delete r.worldId,r=>delete r.foundryBuild,r=>r.foundryGeneration=13,r=>r.foundryBuild='unknown']) {
    const {state,port}=fixture();change(state.runtime);assert.equal((await port.prepare(request())).reason.code,'profile-missing');
  }
});
test('separate v0.92.4 source profile is inspected independently and remains disabled',async()=>{
  const {state,port}=fixture();state.runtime.profileId='cpr-v0.92.4-study';state.runtime.systemVersion='v0.92.4';
  const result=await port.prepare(request());assert.equal(result.reason.code,'unsupported-native-api');assert.equal(result.runtime.systemVersion,'v0.92.4');
});
test('provider failure and native getters do not escape raw private errors',async()=>{
  const port=new NativeActionPort({resolveCurrentSelection:()=>{throw new Error('private body');},getRuntimeProfile:()=>({})});
  const result=await port.prepare(request());assert.equal(result.reason.code,'provider-unavailable');assert.ok(!JSON.stringify(result).includes('private body'));
  const {state,port:p}=fixture();Object.defineProperty(state.context,'token',{get(){throw new Error('native failed');}});
  assert.equal((await p.prepare(request())).reason.code,'provider-unavailable');
});
test('selection is resolved after awaiting runtime provider and stale intent is blocked',async()=>{
  const {state,token}=fixture();let resume;const gate=new Promise(resolve=>{resume=resolve;});
  const port=new NativeActionPort({getRuntimeProfile:async()=>{await gate;return state.runtime;},resolveCurrentSelection:()=>state.context});
  const pending=port.prepare(request());token.document.uuid='Scene.lab.Token.changed';resume();
  assert.equal((await pending).reason.code,'stale-selection');
});
test('explicit manual fallback calls only public sheet.render on current owned actor',async()=>{
  const {port,calls}=fixture();const result=await port.openFallback(request());
  assert.equal(result.status,'requested');assert.equal(result.operation,'ui.actorSheet');assert.equal(result.capabilities.nativeRoll,false);
  assert.equal(result.gameplayDispatched,false);assert.equal(result.provenNoGameMutation,false);
  assert.equal(calls.render,1);assert.equal(calls.gameplay,0);
});
test('fallback also rechecks current ownership and requires an available sheet',async()=>{
  const {actor,port,calls}=fixture();actor.sheet=null;assert.equal((await port.openFallback(request())).reason.code,'sheet-unavailable');
  actor.sheet={render:()=>{throw new Error('private sheet');}};
  const result=await port.openFallback(request());assert.equal(result.reason.code,'sheet-failed');assert.ok(!JSON.stringify(result).includes('private sheet'));assert.equal(calls.gameplay,0);
});
test('return values contain no Document, raw system object or native method',async()=>{
  const {port,actor,item}=fixture();actor.system={secret:123};item.system={damage:'5d6',secret:456};
  const result=await port.prepare(request());const encoded=JSON.stringify(result);
  assert.ok(!encoded.includes('secret'));assert.ok(!encoded.includes('5d6'));assert.ok(!encoded.includes('createRoll'));
  assert.deepEqual(Object.keys(result.subject).sort(),['actorUuid','name','tokenUuid','weaponId']);
});
