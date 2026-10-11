import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationFromProjection,invalidatePreparationDraft,changePreparationField} from '../scripts/adapters/preparation-port.mjs';
import {renderPreparationPanel} from '../scripts/ui/preparation-panel.mjs';
const model=()=>({system:{id:'cyberpunk-red-core',version:'unverified'},selected:{tokenUuid:'Scene.lab.Token.player',own:true,detail:{supported:true,weapons:[{id:'gun',name:'Винтовка',weaponType:'assaultRifle',ranged:true,rof:1,magazine:{value:10,max:25}}]}},targets:[{tokenUuid:'Scene.lab.Token.npc',own:false,name:'Охрана',detail:null}]});
const options={distance:'26',distanceConfirmed:true,cover:'clear',modifier:'-2',modifiersReviewed:true,profileReviewed:true};
test('native projection creates a ready preview with conditional DV and no game execution',()=>{
 const m=model(),before=JSON.stringify(m);const result=preparationFromProjection(m,options,'gun');
 assert.equal(result.plan.status,'ready');assert.equal(result.plan.dv.value,13);assert.equal(result.plan.defense.needsGM,true);assert.equal(result.plan.costs.consumeNow,false);assert.equal(result.plan.capabilities.nativeRoll,false);assert.equal(JSON.stringify(m),before);
});
test('caller cannot provide permission, enemy REF or a hidden target by ID',()=>{
 const result=preparationFromProjection(model(),{...options,targetUuid:'Scene.lab.Token.secret',owner:true,reflex:8,defense:{dataAuthorized:true}},'gun');
 assert.equal(result.plan.status,'blocked');assert.equal(result.plan.targetId,null);assert.equal(result.plan.defense.eligibility,'unknown');assert.ok(result.plan.reasons.some(r=>r.code==='noTarget'));
});
test('stale explicit weapon does not silently select a different weapon',()=>{
 const result=preparationFromProjection(model(),options,'removed');assert.equal(result.plan.status,'blocked');assert.equal(result.plan.weaponId,null);
});
test('empty magazine is read again for every preparation',()=>{
 const m=model();assert.equal(preparationFromProjection(m,options).plan.status,'ready');m.selected.detail.weapons[0].magazine.value=0;
 assert.ok(preparationFromProjection(m,options).plan.reasons.some(r=>r.code==='emptyMagazine'));
});
test('multiple current targets require an explicit choice',()=>{
 const m=model();m.targets.push({tokenUuid:'Scene.lab.Token.second',name:'Вторая цель',own:false});
 assert.ok(preparationFromProjection(m,options).plan.reasons.some(r=>r.code==='noTarget'));
 assert.equal(preparationFromProjection(m,{...options,targetUuid:m.targets[1].tokenUuid}).plan.targetId,m.targets[1].tokenUuid);
});
test('profile confirmation and range/modifier review remain explicit',()=>{
 const result=preparationFromProjection(model(),{});assert.equal(result.plan.status,'blocked');assert.equal(result.plan.costs.ammo,null);assert.ok(result.plan.reasons.some(r=>r.code==='unknownWeaponProfile'));assert.ok(result.plan.reasons.some(r=>r.code==='unknownDistance'));
});
test('missing owner projection cannot be repaired by supplied form fields',()=>{
 const m=model();m.selected.own=false;assert.ok(preparationFromProjection(m,{...options,owner:true}).plan.reasons.some(r=>r.code==='noOwner'));
});
test('preparation renderer escapes names and still offers the native sheet fallback',()=>{
 const m=model();m.targets[0].name='<img src=x onerror=alert(1)>';m.selected.detail.weapons[0].name='<script>unsafe</script>';
 const html=renderPreparationPanel(preparationFromProjection(m,options),m);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/data-rl-action="actor-sheet"/);assert.match(html,/Сейчас ничего не списывается/);
});
test('moving the selected token or target invalidates checked range and cover',()=>{
 const m=model();for(const uuid of [m.selected.tokenUuid,m.targets[0].tokenUuid]){const draft=invalidatePreparationDraft(options,'updateToken',{uuid},m);assert.equal(draft.distanceConfirmed,false);assert.equal(draft.cover,'unknown');assert.equal(options.distanceConfirmed,true);}
});
test('changes to owned actor or its items require new modifier/profile review',()=>{
 const m=model();m.selected.actorUuid='Actor.player';
 for(const [event,doc] of [['updateActor',{uuid:'Actor.player'}],['updateItem',{parent:{uuid:'Actor.player'}}]]){const draft=invalidatePreparationDraft(options,event,doc,m);assert.equal(draft.modifiersReviewed,false);assert.equal(draft.profileReviewed,false);}
});
test('unrelated actor/token changes preserve current manual review',()=>{
 const m=model();m.selected.actorUuid='Actor.player';assert.deepEqual(invalidatePreparationDraft(options,'updateToken',{uuid:'Scene.lab.Token.other'},m),options);assert.deepEqual(invalidatePreparationDraft(options,'updateActor',{uuid:'Actor.other'},m),options);
});
test('changing target or distance invalidates old manual confirmation without modifying the input',()=>{
 const draft={...options,targetUuid:'one'};
 const changed=changePreparationField(draft,'targetUuid','two');assert.equal(changed.distanceConfirmed,false);assert.equal(changed.cover,'unknown');assert.equal(draft.distanceConfirmed,true);
 assert.equal(changePreparationField(draft,'distance','50').distanceConfirmed,false);
 assert.equal(changePreparationField(draft,'distance',draft.distance).distanceConfirmed,true);
});
test('editing modifiers requires review again; permission fields cannot enter the draft',()=>{
 const draft=changePreparationField(options,'modifier','-8');assert.equal(draft.modifiersReviewed,false);
 assert.equal(changePreparationField(draft,'modifiersReviewed',true).modifiersReviewed,true);
 assert.deepEqual(changePreparationField(options,'owner',true),options);
});
