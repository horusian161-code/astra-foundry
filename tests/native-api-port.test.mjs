import test from 'node:test';
import assert from 'node:assert/strict';
import {invokeNativeOperation} from '../scripts/adapters/native-api-port.mjs';
const fake=()=>({snapshot:()=>({queue:[],selected:null,targets:[]}),attackPreview:options=>({options,plan:{status:'blocked'}}),open:async()=>true,close:async()=>false,toggle:async()=>true});
test('native catalog cannot execute gameplay mutations',async()=>{
 for(const id of ['attack.execute','damage.apply','ammo.change','combat.nextTurn'])await assert.rejects(invokeNativeOperation(fake(),id,{}),{code:'unsupported'});
});
test('native API rejects permission assertions and incorrect types before controller access',async()=>{
 let calls=0;const controller={attackPreview:()=>{calls++;}};
 for(const args of [{owner:true},{role:'gm'},{target:{reflex:8}},{distanceConfirmed:'yes'},{cover:'plus-two'},[],null])await assert.rejects(invokeNativeOperation(controller,'attack.preview',args));
 assert.equal(calls,0);
});
test('native API reads only the current controller projection',async()=>{
 const c=fake();assert.deepEqual(await invokeNativeOperation(c,'read.snapshot',{}),c.snapshot());
 await assert.rejects(invokeNativeOperation(c,'read.snapshot',{actorUuid:'Actor.other'}),{code:'invalid-input'});
 assert.equal((await invokeNativeOperation(c,'attack.preview',{distance:'26',profileReviewed:true})).plan.status,'blocked');
});
test('native API rejects functions/accessors and unbounded strings',async()=>{
 await assert.rejects(invokeNativeOperation(fake(),'attack.preview',{targetUuid:'x'.repeat(300)}));
 const args={};Object.defineProperty(args,'distance',{enumerable:true,get(){throw new Error('must not invoke');}});
 await assert.rejects(invokeNativeOperation(fake(),'attack.preview',args));
 await assert.rejects(invokeNativeOperation(fake(),'attack.preview',{distance:()=>26}));
});
