import test from 'node:test';import assert from 'node:assert/strict';
const registrations=new Map();let nextId=1;
globalThis.Application=class {constructor(){this.rendered=false;}render(){this.rendered=true;return this;}async close(){this.rendered=false;return this;}};
globalThis.Hooks={once(){},on(name,fn){const id=nextId++;registrations.set(id,{name,fn});return id;},off(name,id){assert.equal(registrations.get(id)?.name,name);registrations.delete(id);}};
globalThis.window=new EventTarget();
const {REDLINEController}=await import('../scripts/main.mjs');
test('direct V1 Application.close releases controller Hooks/timer and permits reopen without duplicates',async()=>{
 const baseline=registrations.size;const controller=new REDLINEController();await controller.open();const count=registrations.size;assert.ok(count>10);const originalScheduler=controller.scheduler;let refresh=0;controller.application.refresh=()=>refresh++;
 controller.scheduler.request();await controller.application.close();assert.equal(registrations.size,baseline);assert.equal(controller.scope,null);assert.equal(controller.scheduler,null);originalScheduler.request();
 await new Promise(resolve=>setTimeout(resolve,75));assert.equal(refresh,0);await controller.application.close();assert.equal(registrations.size,baseline);
 await controller.open();assert.equal(registrations.size,count);await controller.close();assert.equal(registrations.size,baseline);
});
