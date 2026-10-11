import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAttack} from '../scripts/adapters/cpr-attack-plan.mjs';
const fixture=()=>({
  attacker:{id:'Scene.demo.Token.choom',owner:true,visible:true},
  weapon:{id:'Item.rifle',kind:'assaultRifle',ranged:true,rof:1,profileVerified:true,magazine:{value:30,max:30}},
  target:{id:'Scene.demo.Token.guard',visible:true,cover:'clear',defense:{reflex:7,aware:true,canDodge:true,exception:'none',dataAuthorized:true}},
  distance:{value:12,unit:'m',source:'manual',measurementVerified:true},mode:'single',modifiers:[],modifiersComplete:true
});
const codes=plan=>plan.reasons.map(r=>r.code);
const frozen=input=>{for(const value of Object.values(input)) if(value&&typeof value==='object') frozen(value);return Object.freeze(input);};
test('ordinary single attack is a deterministic preview and never spends resources',()=>{
  const input=frozen(fixture()), before=JSON.stringify(input),plan=prepareAttack(input);
  assert.equal(plan.status,'ready');assert.equal(plan.dv.value,16);assert.equal(plan.dv.source,'range-table');
  assert.equal(plan.costs.ammo,1);assert.equal(plan.costs.consumeNow,false);assert.equal(plan.costs.actionBudgetTracked,false);
  assert.equal(plan.capabilities.nativeRoll,false);assert.equal(plan.capabilities.ammoChange,false);
  assert.equal(plan.defense.eligibility,'ineligible');assert.equal(plan.defense.executionAllowed,false);
  assert.deepEqual(prepareAttack(input),plan);assert.equal(JSON.stringify(input),before);
});
test('all documented AR and pistol range band edges use their own tables',()=>{
  const bounds=[[0,6],[7,12],[13,25],[26,50],[51,100],[101,200],[201,400],[401,800]];
  for(const [kind,table] of [['assaultRifle',[17,16,15,13,15,20,25,30]],['pistol',[13,15,20,25,30,30,null,null]]])
    for(let band=0;band<bounds.length;band++) for(const value of bounds[band]) {
      const input=fixture();input.weapon.kind=kind;input.distance.value=value;
      const plan=prepareAttack(input);assert.equal(plan.dv.value,table[band],`${kind} ${value}`);
      assert.equal(plan.status,table[band]===null?'blocked':'ready');
    }
});
test('AR 26 m is DV 13, not the adjacent band DV 15',()=>{
  const input=fixture();input.distance.value=26;assert.equal(prepareAttack(input).dv.value,13);
});
test('unsupported pistol range and out-of-table range never fabricate a hit',()=>{
  for(const [kind,value] of [['pistol',201],['assaultRifle',801]]) {
    const input=fixture();input.weapon.kind=kind;input.distance.value=value;const plan=prepareAttack(input);
    assert.equal(plan.status,'blocked');assert.equal(plan.dv.value,null);assert.ok(codes(plan).includes('unknownDV'));
  }
});
test('distance with no unit, confirmation or unsupported fractional policy is blocked',()=>{
  for(const change of [d=>d.unit='ft',d=>d.value=-1,d=>d.value=null,d=>d.measurementVerified=false,d=>d.source='guessed',d=>d.value=6.01]) {
    const input=fixture();change(input.distance);const plan=prepareAttack(input);
    assert.equal(plan.status,'blocked');assert.equal(plan.dv.value,null);
  }
});
test('m and game-rule yd use the labelled rules bands without physical unit conversion',()=>{
  const input=fixture();input.distance.unit='yd';input.distance.value=26;
  assert.equal(prepareAttack(input).dv.value,13);assert.equal(prepareAttack(input).distance.unit,'yd');
});
test('zero ammunition is empty, distinct from missing ammunition',()=>{
  const empty=fixture();empty.weapon.magazine.value=0;assert.ok(codes(prepareAttack(empty)).includes('emptyMagazine'));
  const unknown=fixture();unknown.weapon.magazine.value=null;assert.ok(codes(prepareAttack(unknown)).includes('unknownAmmo'));
  assert.ok(!codes(prepareAttack(unknown)).includes('emptyMagazine'));
});
test('unreviewed ordinary weapon profile blocks cost certainty and preparing special weapons',()=>{
  const input=fixture();delete input.weapon.profileVerified;const plan=prepareAttack(input);
  assert.equal(plan.status,'blocked');assert.ok(codes(plan).includes('unknownWeaponProfile'));
  assert.equal(plan.costs.ammo,null);assert.equal(plan.costs.profileVerified,false);assert.equal(plan.costs.consumeNow,false);
});
test('invalid magazine and ROF are blocked instead of inferred',()=>{
  const over=fixture();over.weapon.magazine.value=31;assert.ok(codes(prepareAttack(over)).includes('invalidMagazine'));
  const rof=fixture();rof.weapon.rof=null;assert.ok(codes(prepareAttack(rof)).includes('unknownROF'));
});
test('no weapon and unsupported exotic/ranged modes are explicit blocked cases',()=>{
  const none=fixture();none.weapon=null;assert.ok(codes(prepareAttack(none)).includes('noWeapon'));
  const exotic=fixture();exotic.weapon.kind='exotic';assert.ok(codes(prepareAttack(exotic)).includes('unsupportedWeapon'));
  for(const mode of ['aimed','autofire','suppressive','normal']) {
    const input=fixture();input.mode=mode;const plan=prepareAttack(input);
    assert.equal(plan.status,'blocked');assert.ok(codes(plan).includes('unsupportedMode'));
  }
});
test('aimed rule metadata is minus eight and ROF one but remains unsupported',()=>{
  const mode=prepareAttack(fixture()).allowedModes.find(m=>m.id==='aimed');
  assert.equal(mode.ruleModifier,-8);assert.equal(mode.rof,1);assert.equal(mode.supported,false);
});
test('unauthorised attacker resources and modifier totals do not escape',()=>{
  const input=fixture();input.attacker.owner=false;input.modifiers=[{id:'private',label:'Private',value:10,checked:true,source:'owned actor'}];
  const plan=prepareAttack(input);assert.equal(plan.status,'blocked');assert.equal(plan.weaponId,null);
  assert.equal(plan.costs,null);assert.deepEqual(plan.modifiers.entries,[]);assert.equal(plan.modifiers.total,null);
});
test('hidden target identity and private defense evidence do not escape',()=>{
  const input=fixture();input.target.visible=false;input.target.id='secret-id';input.target.defense.reflex=9;
  const plan=prepareAttack(input);assert.equal(plan.status,'blocked');assert.equal(plan.targetId,null);
  assert.equal(plan.defense.eligibility,'unknown');assert.ok(!JSON.stringify(plan).includes('secret-id'));
});
test('full cover blocks direct shot, no invented cover modifier',()=>{
  const input=fixture();input.target.cover='blocked';const plan=prepareAttack(input);
  assert.equal(plan.status,'blocked');assert.ok(codes(plan).includes('coverBlocked'));
  assert.equal(plan.modifiers.total,0);assert.ok(!plan.modifiers.entries.some(e=>e.id==='cover'));
});
test('unreviewed cover is separate from an asserted clear shot',()=>{
  const input=fixture();input.target.cover='partial';assert.ok(codes(prepareAttack(input)).includes('coverUnknown'));
});
test('REF 8 ordinary defense requires authorised perception and no dodge prohibition',()=>{
  const input=fixture();input.target.defense.reflex=8;const plan=prepareAttack(input);
  assert.equal(plan.defense.eligibility,'eligible');assert.deepEqual(plan.defense.options,['range','evade']);
  assert.equal(plan.defense.opposedDV,null);assert.equal(plan.dv.conditional,true);
  assert.equal(plan.defense.timing,'declare-and-roll-before-attack');
  for(const key of ['aware','canDodge']) {const absent=fixture();absent.target.defense.reflex=8;delete absent.target.defense[key];assert.equal(prepareAttack(absent).defense.eligibility,'unknown');}
});
test('unknown or unauthorised enemy REF leaves a ready preview requiring GM review',()=>{
  for(const defense of [undefined,{reflex:8,aware:true,canDodge:true,exception:'none',dataAuthorized:false}]) {
    const input=fixture();if(defense===undefined) delete input.target.defense;else input.target.defense=defense;
    const plan=prepareAttack(input);assert.equal(plan.status,'ready');assert.equal(plan.dv.value,16);
    assert.equal(plan.defense.eligibility,'unknown');assert.equal(plan.defense.needsGM,true);assert.deepEqual(plan.defense.options,[]);
    assert.equal(plan.dv.conditional,true);assert.equal(plan.defense.executionAllowed,false);
    assert.ok(!Object.hasOwn(plan.defense,'reflex'));
  }
});
test('known inability or unperceived attack removes ordinary Evasion; exceptions require GM',()=>{
  for(const key of ['aware','canDodge']) {const input=fixture();input.target.defense.reflex=8;input.target.defense[key]=false;assert.equal(prepareAttack(input).defense.eligibility,'ineligible');}
  const input=fixture();input.target.defense.exception='enabled';assert.equal(prepareAttack(input).defense.eligibility,'unknown');assert.equal(prepareAttack(input).defense.needsGM,true);
});
test('checked modifier audit distinguishes zero from unknown and excludes disabled entries',()=>{
  const input=fixture();input.modifiers=[
    {id:'wound',label:'Ранение',value:-2,checked:true,source:'Actor derived state'},
    {id:'gm',label:'Ситуация GM',value:null,checked:false,enabled:false,source:'GM review'}
  ];
  const plan=prepareAttack(input);assert.equal(plan.status,'ready');assert.equal(plan.modifiers.total,-2);
  assert.equal(plan.modifiers.entries[1].status,'excluded');assert.equal(plan.modifiers.formulaCertified,false);
  input.modifiers[1].enabled=true;const unresolved=prepareAttack(input);
  assert.equal(unresolved.status,'blocked');assert.equal(unresolved.modifiers.total,null);assert.ok(codes(unresolved).includes('uncheckedModifiers'));
});
test('duplicate modifier IDs and missing modifier completeness cannot fake a total',()=>{
  const input=fixture();input.modifiersComplete=false;assert.equal(prepareAttack(input).modifiers.total,null);
  input.modifiersComplete=true;input.modifiers=[{id:'x',label:'x',value:0,checked:true,source:'fixture'},{id:'x',label:'x',value:1,checked:true,source:'fixture'}];
  assert.ok(codes(prepareAttack(input)).includes('invalidModifiers'));assert.equal(prepareAttack(input).modifiers.total,null);
});
test('bounded plain inputs reject documents, non-finite values, excess arrays and accessors without reading them',()=>{
  let reads=0;const getter=fixture();Object.defineProperty(getter.target,'visible',{get(){reads++;return true;},enumerable:true});
  const arrayGetter=fixture();Object.defineProperty(arrayGetter.modifiers,'0',{get(){reads++;return {};},enumerable:true});arrayGetter.modifiers.length=1;
  for(const input of [null,[],new Date(),{...fixture(),bad:()=>{}},{...fixture(),bad:NaN},{...fixture(),bad:Array(65).fill(0)},getter,arrayGetter]) {
    const plan=prepareAttack(input);assert.equal(plan.status,'blocked');assert.deepEqual(codes(plan),['invalidInput']);
  }
  assert.equal(reads,0);
});
