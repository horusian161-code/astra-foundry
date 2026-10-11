import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoTurnState,projectDemoInitiative,advanceDemoTurn} from '../scripts/demo/turns.mjs';
const queue=Array.from({length:4},(_,i)=>({id:'actor-'+i}));
const completed=id=>({id,operation:'demo.redline.attack',state:'resolved',result:{hit:true},receipt:{requestId:id,applied:true}});
test('demo initiative advances only current/next; round increments on wrap',()=>{
  const before=createDemoTurnState({turn:3,round:3}),after=advanceDemoTurn(before,queue,completed('attack-one'));
  assert.equal(after.turn,0);assert.equal(after.round,4);assert.equal(before.turn,3);assert.equal(before.round,3);
  const projected=projectDemoInitiative(queue,after);assert.equal(projected.find(row=>row.current).id,'actor-0');assert.equal(projected.find(row=>row.next).id,'actor-1');
});
test('same completed request cannot advance again; missing receipt or request rejects',()=>{
  const once=advanceDemoTurn(createDemoTurnState(),queue,completed('attack-two'));
  assert.throws(()=>advanceDemoTurn(once,queue,completed('attack-two')),/уже продвинул/);
  for(const operation of [null,{...completed('waiting'),state:'waiting'},{...completed('no-receipt'),receipt:null},{...completed('wrong-receipt'),receipt:{requestId:'other',applied:true}}])assert.throws(()=>advanceDemoTurn(once,queue,operation),/квитанци/);
  assert.equal(once.turn,2);assert.equal(once.round,3);
});
test('empty queue has no current/next and cannot advance; 40 participants wrap correctly',()=>{
  const state=createDemoTurnState({turn:39,round:3});assert.deepEqual(projectDemoInitiative([],state),[]);assert.throws(()=>advanceDemoTurn(state,[],completed('empty')),/Нет участников/);
  const many=Array.from({length:40},(_,i)=>({id:`many-${i}`})),after=advanceDemoTurn(state,many,completed('many-wrap'));
  assert.equal(after.turn,0);assert.equal(after.round,4);assert.equal(projectDemoInitiative(many,after).filter(row=>row.current).length,1);assert.equal(projectDemoInitiative(many,after).find(row=>row.next).id,'many-1');
});
test('demo initiative persistence retains advanced receipt IDs without serializing selected token or target',()=>{
  const advanced=advanceDemoTurn(createDemoTurnState(),queue,completed('saved-progress'));
  const restored=createDemoTurnState(JSON.parse(JSON.stringify(advanced)));
  assert.deepEqual(restored,advanced);assert.throws(()=>advanceDemoTurn(restored,queue,completed('saved-progress')),/уже продвинул/);
  assert.equal(restored.selectedId,undefined);assert.equal(restored.targetId,undefined);
});
