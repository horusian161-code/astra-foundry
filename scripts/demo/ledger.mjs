/** Demo domain boundary. No Foundry documents or game globals are used. */
const INITIAL_AMMO=Object.freeze({'proxy:rifle':25,'proxy:pistol':8,'nana:rifle':25,'nana:pistol':8,'gemini:rifle':25,'gemini:pistol':8});
export const INITIAL_DEMO_RESOURCES = Object.freeze({schemaVersion:2,ammo:25,ammoByKey:INITIAL_AMMO,targetHP:40,targetSP:11});
const copy=value=>JSON.parse(JSON.stringify(value));
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id);
const schemaError=message=>Object.assign(new Error(message),{code:'demo-storage-corrupt'});
const bounded=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
export const demoAmmoKey=(attackerId,weaponId)=>`${attackerId}:${weaponId}`;
export const demoMagazineMaximum=weaponId=>weaponId==='pistol'?8:weaponId==='rifle'?25:null;
export function readDemoAmmo(state,key){return Object.hasOwn(INITIAL_AMMO,key)&&Number.isSafeInteger(state?.ammoByKey?.[key])?state.ammoByKey[key]:null;}
function normalizedState(state){
  if(state?.schemaVersion===2){
    if(!bounded(state.targetHP,40)||!bounded(state.targetSP,11)||!bounded(state.ammo,25)||state.ammo!==state.ammoByKey?.['proxy:rifle']||Object.keys(state.ammoByKey || {}).length!==Object.keys(INITIAL_AMMO).length||!Object.entries(INITIAL_AMMO).every(([key,max])=>bounded(state.ammoByKey?.[key],max)))throw schemaError('Повреждена схема деморесурсов v2. Автоматический сброс запрещён.');
    return copy(state);
  }
  // Previous scalar magazine can only be assigned to the original Proxy/AR fixture.
  if(state?.schemaVersion===undefined&&Object.keys(state||{}).sort().join(',')==='ammo,targetHP,targetSP'&&bounded(state.ammo,25)&&bounded(state.targetHP,40)&&bounded(state.targetSP,11))return {...copy(INITIAL_DEMO_RESOURCES),ammo:state.ammo,ammoByKey:{...INITIAL_AMMO,'proxy:rifle':state.ammo},targetHP:state.targetHP,targetSP:state.targetSP,migratedFrom:'legacy-proxy-rifle-only'};
  throw schemaError('Неизвестная версия деморесурсов. Автоматический сброс запрещён.');
}
function mutation(state,command) {
  const ammoKey=command.ammoKey || 'proxy:rifle',ammo=readDemoAmmo(state,ammoKey);
  if(ammo===null)throw new Error('Неизвестен магазин конкретного демоперсонажа и оружия.');
  if(ammo<1)throw new Error('Магазин демоперсонажа пуст. Подготовьте новый сценарий.');
  if(!Number.isSafeInteger(command.attackTotal)||!Number.isSafeInteger(command.dv)||!Number.isSafeInteger(command.damage))throw new Error('Некорректный деморезультат.');
  const hit=command.attackTotal>command.dv, armorBefore=state.targetSP;
  const hpLoss=hit?Math.max(0,command.damage-armorBefore):0;
  const ammoByKey={...state.ammoByKey,[ammoKey]:ammo-1};
  const after={...state,ammo:ammoByKey['proxy:rifle'],ammoByKey,targetHP:Math.max(0,state.targetHP-hpLoss),targetSP:hit&&hpLoss>0?Math.max(0,state.targetSP-1):state.targetSP};
  return {after,output:{public:{hit,attackTotal:command.attackTotal,dv:command.dv,dvSource:command.dvSource,damage:hit?command.damage:0,ammoSpent:1,ammoKey,targetResourceChanged:hpLoss>0},private:{armorBefore,armorAfter:after.targetSP,hpLoss,targetHPBefore:state.targetHP,targetHPAfter:after.targetHP}}};
}
function makeReceipt(requestId,namespace,state,command) {
  const {after,output}=mutation(state,command);
  const receipt={id:`demo-receipt:${requestId}`,requestId,applied:true,namespace,at:Date.now()};
  return {after,value:{...output,receipt},signature:JSON.stringify(command)};
}
export class MemoryDemoLedger {
  #resources=new Map();#receipts=new Map();#gate=Promise.resolve();
  async load(namespace,initial=INITIAL_DEMO_RESOURCES){if(!this.#resources.has(namespace))this.#resources.set(namespace,normalizedState(initial));return copy(this.#resources.get(namespace));}
  async receipt(requestId){return copy(this.#receipts.get(requestId)?.value || null);}
  async verifiedReceipt(namespace,requestId,command){const receipt=this.#receipts.get(requestId);return receipt?.value?.receipt?.namespace===namespace&&receipt.signature===JSON.stringify(command)?copy(receipt.value):null;}
  applyOnce(namespace,requestId,command) {
    const operation=this.#gate.then(async()=>{
      if(!validId(requestId)||!validId(namespace))throw new Error('Некорректный идентификатор демооперации.');
      const prior=this.#receipts.get(requestId);
      if(prior){if(prior.signature!==JSON.stringify(command)||prior.value.receipt.namespace!==namespace)throw new Error('Идентификатор уже принадлежит другой операции.');return copy(prior.value);}
      const state=await this.load(namespace),commit=makeReceipt(requestId,namespace,state,command);
      this.#resources.set(namespace,commit.after);this.#receipts.set(requestId,commit);return copy(commit.value);
    });
    this.#gate=operation.catch(()=>{});return operation;
  }
}
/** State and receipt share one readwrite transaction; reload cannot apply twice. */
export class IndexedDBDemoLedger {
  #database;
  constructor({name='astra-redline-demo-domain-v1',indexedDB=globalThis.indexedDB}={}) {
    if(!indexedDB)throw new Error('IndexedDB недоступен. Сохраняемый стенд нельзя запустить в этом браузере.');
    this.#database=new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('domain');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Демохранилище заблокировано другим окном.'));
    });
  }
  async load(namespace,initial=INITIAL_DEMO_RESOURCES) {
    if(!validId(namespace))throw new Error('Некорректный идентификатор демосценария.');
    const db=await this.#database;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('domain','readwrite'),store=tx.objectStore('domain'),request=store.get(`state:${namespace}`);let value;
      request.onsuccess=()=>{try{value=normalizedState(request.result || initial);if(!request.result||request.result.schemaVersion!==2)store.put(value,`state:${namespace}`);}catch(error){tx.abort();reject(error);}};
      tx.oncomplete=()=>resolve(copy(value));tx.onabort=tx.onerror=()=>reject(tx.error || request.error || new Error('Не удалось сохранить демосостояние.'));
    });
  }
  async receipt(requestId) {
    const db=await this.#database;
    return new Promise((resolve,reject)=>{const tx=db.transaction('domain'),request=tx.objectStore('domain').get(`receipt:${requestId}`);request.onsuccess=()=>resolve(copy(request.result?.value || null));request.onerror=()=>reject(request.error);});
  }
  async verifiedReceipt(namespace,requestId,command) {
    const db=await this.#database;
    return new Promise((resolve,reject)=>{const tx=db.transaction('domain'),request=tx.objectStore('domain').get(`receipt:${requestId}`);request.onsuccess=()=>{const receipt=request.result;resolve(receipt?.value?.receipt?.namespace===namespace&&receipt.signature===JSON.stringify(command)?copy(receipt.value):null);};request.onerror=()=>reject(request.error);});
  }
  async applyOnce(namespace,requestId,command) {
    if(!validId(namespace)||!validId(requestId))throw new Error('Некорректный идентификатор демооперации.');
    const db=await this.#database;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('domain','readwrite'),store=tx.objectStore('domain'),prior=store.get(`receipt:${requestId}`);let answer,error;
      const abort=problem=>{error=problem;tx.abort();};
      prior.onsuccess=()=>{
        if(prior.result){if(prior.result.signature!==JSON.stringify(command)||prior.result.value.receipt.namespace!==namespace)return abort(new Error('Идентификатор уже принадлежит другой операции.'));answer=prior.result.value;return;}
        const resource=store.get(`state:${namespace}`);
        resource.onsuccess=()=>{try{const commit=makeReceipt(requestId,namespace,normalizedState(resource.result || INITIAL_DEMO_RESOURCES),command);store.put(commit.after,`state:${namespace}`);store.put(commit,`receipt:${requestId}`);answer=commit.value;}catch(problem){abort(problem);}};
      };
      tx.oncomplete=()=>resolve(copy(answer));tx.onabort=tx.onerror=()=>reject(error || tx.error || new Error('Транзакция деморесурсов не завершена.'));
    });
  }
  async close(){(await this.#database).close();}
}
