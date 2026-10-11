import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryDemoLedger,readDemoAmmo} from '../scripts/demo/ledger.mjs';
import {createDemoAttackDescriptor} from '../scripts/demo/attack-operation.mjs';
import {OperationEngine,MemoryStore} from '../scripts/sdk/index.mjs';
import {renderWorkflowPanel,workflowPhaseForOperation} from '../scripts/ui/workflow-render.mjs';
import {commitDemoManualOverride,applyDemoManualOverride} from '../scripts/demo/planning.mjs';
const principal={id:'demo-user',role:'player'};
const defaultView=state=>({ammo:state.ammo,targetHP:state.targetHP,targetSP:state.targetSP});
const args={namespace:'encounter-one',attackerId:'proxy',attackerName:'Прокси',targetId:'guard',targetName:'Охрана',weaponId:'rifle',weaponName:'Винтовка',rangeDV:13,dvSource:'range-table'};
test('demo resources and receipt apply exactly once for concurrent repeated command',async()=>{
  const ledger=new MemoryDemoLedger(),command={attackTotal:19,damage:18,dv:13,dvSource:'range'};
  const results=await Promise.all(Array.from({length:10},()=>ledger.applyOnce('encounter-one','demo-request-one',command)));
  for(const result of results)assert.deepEqual(result,results[0]);
  assert.deepEqual(defaultView(await ledger.load('encounter-one')),{ammo:24,targetHP:33,targetSP:10});
  await assert.rejects(ledger.applyOnce('encounter-one','demo-request-one',{...command,damage:30}),/другой операции/);
});
test('demo engine does not generate attack sample until decision; prep consumes nothing',async()=>{
  const ledger=new MemoryDemoLedger(),engine=new OperationEngine({store:new MemoryStore(),descriptors:[createDemoAttackDescriptor({ledger})],executorId:'demo-browser'});
  const operation=await engine.prepare({operation:'demo.redline.attack',args,requestId:'demo-request-two',principal});
  assert.equal(operation.state,'waiting');
  assert.equal(JSON.stringify(operation).includes('attackTotal'),false);
  assert.deepEqual(defaultView(await ledger.load('encounter-one')),{ammo:25,targetHP:40,targetSP:11});
  await assert.rejects(engine.execute('demo-request-two',{principal}),error=>error.code==='waiting');
  await engine.decide('demo-request-two',{choice:'evade',principal});
  const result=await engine.execute('demo-request-two',{principal});
  assert.equal(result.result.attackTotal,19);
  assert.equal(result.result.dv,17);
  assert.equal(result.result.hpLoss,undefined);
  assert.equal(result.result.armorBefore,undefined);
  const repeated=await engine.execute('demo-request-two',{principal});
  assert.deepEqual(repeated.receipt,result.receipt);
  assert.deepEqual(defaultView(await ledger.load('encounter-one')),{ammo:24,targetHP:33,targetSP:10});
});
test('workflow renderer escapes names and denies GM resources in player view',()=>{
  const view={phase:'gm',isGM:false,authorityResources:{targetHP:987654321,targetSP:123456789},prefs:{scale:1}};
  const denied=renderWorkflowPanel(view);assert.match(denied,/Нет доступа/);assert.doesNotMatch(denied,/987654321|123456789/);
  const prep=renderWorkflowPanel({phase:'prepare',target:{name:'<img src=x onerror=alert(1)>'},weapons:[],prefs:{scale:1},plan:{dv:{value:null},modifiers:{entries:[]},reasons:[]}});
  assert.match(prep,/&lt;img/);assert.doesNotMatch(prep,/<img src=x/);
});
test('demo descriptor rejects precomputed secret and unauthorized inspection',async()=>{
  const descriptor=createDemoAttackDescriptor({ledger:new MemoryDemoLedger()});
  assert.equal(descriptor.validate({...args,attackTotal:999}),false);
  assert.equal(descriptor.permission(args,{principal,stage:'inspect-private'}),false);
  assert.equal(descriptor.permission(args,{principal:{id:'demo-user',role:'gm'},stage:'inspect-private'}),true);
});
test('miss and tie spend one demo cartridge but preserve target resources',async()=>{
  const ledger=new MemoryDemoLedger();
  const result=await ledger.applyOnce('encounter-two','demo-request-three',{attackTotal:17,damage:18,dv:17,dvSource:'evade'});
  assert.equal(result.public.hit,false);assert.equal(result.public.targetResourceChanged,false);
  assert.deepEqual(defaultView(await ledger.load('encounter-two')),{ammo:24,targetHP:40,targetSP:11});
});
test('empty demo magazine rejects mutation and writes no receipt',async()=>{
  const ledger=new MemoryDemoLedger();await ledger.load('empty-encounter',{ammo:0,targetHP:40,targetSP:11});
  await assert.rejects(ledger.applyOnce('empty-encounter','demo-request-four',{attackTotal:19,damage:18,dv:13,dvSource:'range'}),/пуст/);
  assert.equal(await ledger.receipt('demo-request-four'),null);
  assert.deepEqual(defaultView(await ledger.load('empty-encounter')),{ammo:0,targetHP:40,targetSP:11});
});
test('result renderer never includes GM values in a player view',()=>{
  const html=renderWorkflowPanel({phase:'result',isGM:false,operation:{id:'demo-operation',state:'resolved',receipt:{applied:true},result:{hit:true,attackTotal:19,dv:13,damage:18,armorBefore:123456,armorAfter:123455,hpLoss:765432}}});
  assert.doesNotMatch(html,/123456|123455|765432/);assert.match(html,/доступ GM/);
});
test('failed or uncertain execution cannot render a miss or successful application',()=>{
  for(const state of ['failed','uncertain','executing','resolved']){
    const operation={id:'failed-demo',state,result:null,receipt:null,error:{code:'missing-data'}};
    assert.equal(workflowPhaseForOperation(operation),'recovery');
    const html=renderWorkflowPanel({phase:'result',operation,persistence:'memory'});
    assert.match(html,/Нет подтверждённого результата/);assert.doesNotMatch(html,/ПРОМАХ|ПОПАДАНИЕ|Применено один раз/);
  }
  assert.equal(workflowPhaseForOperation({state:'ready'}),'defense');
  assert.equal(workflowPhaseForOperation({state:'resolved',result:{hit:false},receipt:{applied:true}}),'result');
});
test('SDK lab renderer accepts only adapter projections and shows rights denial',()=>{
  const html=renderWorkflowPanel({phase:'sdk-lab',reuse:{outsider:true,journal:{accessible:false,title:'Досье'},base:{accessible:false}}});
  assert.match(html,/Нет доступа/);assert.doesNotMatch(html,/Канал восстановлен|quantity|progress/);
});
test('recovery rejects old receipt with reused ID and changed namespace or arguments',async()=>{
  const ledger=new MemoryDemoLedger(),first=new OperationEngine({store:new MemoryStore(),descriptors:[createDemoAttackDescriptor({ledger})],executorId:'demo-one'});
  await first.prepare({operation:'demo.redline.attack',args,requestId:'receipt-collision',principal});
  await first.decide('receipt-collision',{choice:'accept',principal});await first.execute('receipt-collision',{principal});
  for(const changed of [{...args,namespace:'different-encounter'},{...args,rangeDV:25},{...args,weaponId:'pistol'}]) {
    const engine=new OperationEngine({store:new MemoryStore(),descriptors:[createDemoAttackDescriptor({ledger})],executorId:'demo-two'});
    await engine.prepare({operation:'demo.redline.attack',args:changed,requestId:'receipt-collision',principal});
    await engine.decide('receipt-collision',{choice:'accept',principal});
    assert.equal((await engine.execute('receipt-collision',{principal})).state,'uncertain');
    assert.equal((await engine.recover('receipt-collision',{principal})).state,'uncertain');
  }
  assert.deepEqual(defaultView(await ledger.load('encounter-one')),{ammo:24,targetHP:33,targetSP:10});
});
test('pending UI uses operation participant snapshot after changing selected token',()=>{
  const html=renderWorkflowPanel({phase:'defense',selected:{name:'Нана'},target:{name:'Другая цель'},weapon:{name:'Другое оружие'},operation:{state:'waiting',id:'pending',preview:{attackerName:'Прокси',targetName:'Исходная охрана',weaponName:'Исходная винтовка'},decision:{choice:null}}});
  assert.match(html,/Прокси|Исходная охрана|Исходная винтовка/);assert.doesNotMatch(html,/Другая цель|Другое оружие|Нана/);
});
test('manual draft does not change the plan before an explicit authorized commit',()=>{
  const plan={status:'blocked',reasons:[{code:'unknownDV',message:'DV неизвестен'}],dv:{value:null}};
  assert.equal(applyDemoManualOverride(plan,null),plan);
  assert.throws(()=>commitDemoManualOverride({value:13,source:'Проверено GM'},principal),/GM/);
  const override=commitDemoManualOverride({value:13,source:'Проверено GM'},{id:'demo-user',role:'gm'});
  const after=applyDemoManualOverride(plan,override);assert.equal(after.status,'ready');assert.equal(after.dv.value,13);assert.equal(plan.dv.value,null);
  const blocked=applyDemoManualOverride({...plan,reasons:[...plan.reasons,{code:'emptyMagazine'}]},override);
  assert.equal(blocked.status,'blocked');assert.deepEqual(blocked.reasons,[{code:'emptyMagazine'}]);
});
test('two attackers and weapons consume independent magazines in shared encounter',async()=>{
  const ledger=new MemoryDemoLedger(),engine=new OperationEngine({store:new MemoryStore(),descriptors:[createDemoAttackDescriptor({ledger})],executorId:'demo-browser'});
  for(const [requestId,data] of [['proxy-rifle-attack',{...args,ammoKey:'proxy:rifle'}],['nana-pistol-attack',{...args,attackerId:'nana',attackerName:'Нана',weaponId:'pistol',weaponName:'Тяжёлый пистолет',ammoKey:'nana:pistol',rangeDV:25}]]){
    await engine.prepare({operation:'demo.redline.attack',args:data,requestId,principal});await engine.decide(requestId,{choice:'accept',principal});await engine.execute(requestId,{principal});
  }
  const state=await ledger.load('encounter-one');
  assert.equal(readDemoAmmo(state,'proxy:rifle'),24);assert.equal(readDemoAmmo(state,'nana:pistol'),7);assert.equal(readDemoAmmo(state,'nana:rifle'),25);assert.equal(readDemoAmmo(state,'proxy:pistol'),8);
  assert.equal(state.targetHP,33);assert.equal(state.targetSP,10);
});
test('selection changes cannot redirect pending cost; receipt reconciliation preserves the original magazine',async()=>{
  const ledger=new MemoryDemoLedger(),descriptor=createDemoAttackDescriptor({ledger});
  const interrupted={...descriptor,execute:async(data,context)=>{await descriptor.execute(data,context);throw new Error('Сбой после атомарной квитанции');}};
  const engine=new OperationEngine({store:new MemoryStore(),descriptors:[interrupted],executorId:'demo-browser'});
  const input={...args,ammoKey:'proxy:rifle'};
  await engine.prepare({operation:'demo.redline.attack',args:input,requestId:'pending-magazine',principal});
  input.attackerId='nana';input.attackerName='Нана';input.weaponId='pistol';input.ammoKey='nana:pistol';
  await engine.decide('pending-magazine',{choice:'evade',principal});assert.equal((await engine.execute('pending-magazine',{principal})).state,'uncertain');
  assert.equal((await engine.recover('pending-magazine',{principal})).state,'resolved');
  await engine.execute('pending-magazine',{principal});
  const state=await ledger.load('encounter-one');assert.equal(readDemoAmmo(state,'proxy:rifle'),24);assert.equal(readDemoAmmo(state,'nana:pistol'),8);assert.equal(state.targetHP,33);
});
test('bounded legacy magazine migrates only to original Proxy rifle; unknown schema rejects',async()=>{
  const ledger=new MemoryDemoLedger(),state=await ledger.load('legacy',{ammo:12,targetHP:19,targetSP:8});
  assert.equal(state.schemaVersion,2);assert.equal(state.migratedFrom,'legacy-proxy-rifle-only');assert.equal(readDemoAmmo(state,'proxy:rifle'),12);assert.equal(readDemoAmmo(state,'nana:rifle'),25);assert.equal(readDemoAmmo(state,'proxy:pistol'),8);
  await assert.rejects(ledger.load('unknown-version',{schemaVersion:999,ammo:25,targetHP:40,targetSP:11}),error=>error.code==='demo-storage-corrupt');
});
