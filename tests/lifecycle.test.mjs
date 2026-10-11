import test from 'node:test';import assert from 'node:assert/strict';
import {Scope,RefreshScheduler} from '../scripts/core/lifecycle.mjs';
test('Scope releases listeners and Hooks once, even after repeated disposal',()=>{
 const scope=new Scope(),target=new EventTarget();let events=0,off=0;scope.listen(target,'click',()=>events++);const hooks={on:()=>42,off:(name,id)=>{assert.equal(name,'updateActor');assert.equal(id,42);off++;}};scope.hook(hooks,'updateActor',()=>{});
 target.dispatchEvent(new Event('click'));scope.dispose();scope.dispose();target.dispatchEvent(new Event('click'));assert.equal(events,1);assert.equal(off,1);
 let cleanup=0;scope.track(()=>cleanup++);assert.equal(cleanup,1);
});
test('RefreshScheduler coalesces updates and cancels pending refresh on disposal',async()=>{
 let refresh=0;const scheduler=new RefreshScheduler(()=>refresh++,4);scheduler.request();scheduler.request();await new Promise(resolve=>setTimeout(resolve,12));assert.equal(refresh,1);
 scheduler.request();scheduler.dispose();scheduler.request();await new Promise(resolve=>setTimeout(resolve,12));assert.equal(refresh,1);
});
