/** Browser-only fixture. All mutation is in the demo ledger, never Foundry. */
import {OperationEngine,IndexedDBStore,MemoryStore} from '../sdk/index.mjs';
import {prepareAttack} from '../adapters/cpr-attack-plan.mjs';
import {renderWorkflowBoard,workflowPhaseForOperation} from '../ui/workflow-render.mjs';
import {IndexedDBDemoLedger,MemoryDemoLedger,demoAmmoKey,readDemoAmmo,demoMagazineMaximum} from './ledger.mjs';
import {createDemoAttackDescriptor} from './attack-operation.mjs';
import {createReusableDemo,journalView,baseView} from '../examples/index.mjs';
import {commitDemoManualOverride,applyDemoManualOverride} from './planning.mjs';
import {createDemoTurnState,projectDemoInitiative,advanceDemoTurn} from './turns.mjs';
import {captureFocus,restoreFocus,MotionCoordinator} from '../ui-kit/index.mjs';

const root=document.querySelector('[data-workflow-root]');
const storageKey='astra-redline-workflow-fixture-v2';
const id=prefix=>`${prefix}-${crypto.randomUUID()}`;
const defaults={namespace:id('encounter'),fixture:'normal',selectedId:'proxy',targetId:'guard',weaponId:'rifle',requestId:null,demoCombat:createDemoTurnState(),prefs:{scale:1,compact:false,collapsed:false,reduced:false},phase:'prepare',panelOpen:true,manualDV:null,manualSource:'',manualOverride:null};
let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
const state={...defaults,...saved,prefs:{...defaults.prefs,...saved.prefs},isGM:false,busy:false,notice:'',operation:null,resources:null,gmResult:null,persistence:'indexeddb'};
state.demoCombat=createDemoTurnState(state.demoCombat);
if(!['normal','empty','no-weapon','empty-mag','unknown-dv','hidden','long','many'].includes(state.fixture))state.fixture='normal';
if(![1,1.15,1.3].includes(state.prefs.scale))state.prefs.scale=1;
let ledger,store,engine;
function setupStorage(memory=false){
  ledger=memory?new MemoryDemoLedger():new IndexedDBDemoLedger();
  store=memory?new MemoryStore():new IndexedDBStore({name:'astra-redline-workflow-operations-v2'});
  engine=new OperationEngine({store,descriptors:[createDemoAttackDescriptor({ledger})],executorId:'single-browser-demo-authority'});
  state.persistence=memory?'memory':'indexeddb';
}
try{setupStorage();}catch{setupStorage(true);state.requestId=null;state.phase='prepare';}
let reuse=createReusableDemo(),labNonce=id('reuse'),labLastId=null,labOutsider=false;
const labPrincipal=()=>labOutsider?{id:'outsider',role:'player'}:{id:'player-1',role:'player'};
const reuseView=()=>({journal:journalView(reuse.repository,'dossier',labPrincipal()),base:baseView(reuse.repository,'workshop',labPrincipal()),outsider:labOutsider,recordId:labLastId});
const principal=()=>({id:'demo-user',role:state.isGM?'gm':'player'});
const persist=()=>{const {busy,notice,operation,resources,gmResult,isGM,persistence,...data}=state;try{localStorage.setItem(storageKey,JSON.stringify(data));}catch{state.notice='Настройки не сохраняются: браузер запретил localStorage.';}};
const actors=[{id:'proxy',name:'Прокси',initial:'П',owned:true,initiative:24,current:false},{id:'nana',name:'Нана',initial:'Н',owned:true,initiative:21,current:true},{id:'guard',name:'Корпоративная охрана',initial:'К',owned:false,initiative:17,next:true},{id:'gemini',name:'Геммини',initial:'Г',owned:true,initiative:15}];
function model() {
  let queue=state.fixture==='empty'?[]:actors.map(a=>({...a}));
  if(state.fixture==='many')for(let i=5;i<=40;i++)queue.push({id:'extra-'+i,name:`Участник ${i} · охрана периметра`,owned:false,initiative:15-i,initial:'О'});
  if(state.fixture==='long')queue=queue.map(a=>({...a,name:a.id==='proxy'?'Прокси — специалист по полевой электронике и аварийному ремонту':a.name}));
  queue=projectDemoInitiative(queue,state.demoCombat);
  const selected=queue.find(a=>a.id===state.selectedId&&a.owned) || null;
  const target=state.fixture==='hidden'||state.fixture==='empty'?null:queue.find(a=>a.id===state.targetId) || null;
  const weapons=state.fixture==='no-weapon'||!selected?[]:[{id:'rifle',name:state.fixture==='long'?'Штурмовая винтовка Militech с длинным названием и расширенным описанием':'Militech · штурмовая винтовка',kind:'assaultRifle',damage:'5d6',rof:1},{id:'pistol',name:'Тяжёлый пистолет',kind:'pistol',damage:'3d6',rof:2}];
  const weapon=weapons.find(w=>w.id===state.weaponId)||weapons[0]||null;
  const resources={ammo:state.fixture==='empty-mag'?0:selected&&weapon?readDemoAmmo(state.resources,demoAmmoKey(selected.id,weapon.id)):null,magazineMax:demoMagazineMaximum(weapon?.id)};
  let plan=prepareAttack({attacker:selected?{id:selected.id,owner:true,visible:true}:null,
    weapon:weapon?{id:weapon.id,kind:weapon.kind,profileVerified:true,ranged:true,rof:weapon.rof,magazine:{value:resources.ammo,max:resources.magazineMax}}:null,
    target:target?{id:target.id,visible:true,cover:'clear',defense:{reflex:8,aware:true,exception:'none',canDodge:true,dataAuthorized:true}}:null,
    distance:{value:state.fixture==='unknown-dv'?1000:26,unit:'m',source:'demo',measurementVerified:true},mode:'single',modifiers:[],modifiersComplete:true});
  if(state.fixture==='unknown-dv')plan=applyDemoManualOverride(plan,state.manualOverride);
  const {resources:privateResources,gmResult:privateResult,...publicState}=state;
  return {...publicState,selected,target,queue,round:state.demoCombat.round,weapons,weapon,resources,plan,demo:true,weaponId:weapon?.id,reuse:reuseView(),gmResult:state.isGM?privateResult:null,authorityResources:state.isGM?{targetHP:privateResources?.targetHP,targetSP:privateResources?.targetSP}:undefined};
}
const motion=new MotionCoordinator();
const focusAttributes=['id','data-wf-field','data-wf-action','data-wf-select','data-map-select','data-map-target'];
let previousPhase=null,previousPanelOpen=null,pendingFocusBookmark=null,returnFocusBookmark=null;
function rememberPanelOpener(){if(!root.querySelector('.wf-panel')?.contains(document.activeElement))returnFocusBookmark=captureFocus(document,{attributes:focusAttributes});}
function view(){
  const bookmark=captureFocus(root,{attributes:focusAttributes});
  if(bookmark)pendingFocusBookmark=bookmark;else if(!state.busy)pendingFocusBookmark=null;
  const queueScroll=root.querySelector('.wf-queue')?.scrollLeft||0;
  const panelScroll=root.querySelector('.wf-panel-body')?.scrollTop||0;
  const phaseChanged=previousPhase!==null&&previousPhase!==state.phase;
  const panelOpened=state.panelOpen&&previousPanelOpen!==true;
  const panelClosed=!state.panelOpen&&previousPanelOpen===true;
  const current=model();
  // Bottom bar shows current selection; workflow panel uses immutable public preview names.
  motion.cancelAll('rerender');
  root.innerHTML=renderWorkflowBoard(current);
  const queue=root.querySelector('.wf-queue'),panel=root.querySelector('.wf-panel-body');
  if(queue)queue.scrollLeft=queueScroll;if(panel)panel.scrollTop=phaseChanged?0:panelScroll;
  if(panelClosed){restoreFocus(document,returnFocusBookmark,{fallbackSelectors:['[data-wf-action="attack"]','[data-wf-action="settings"]']});returnFocusBookmark=null;pendingFocusBookmark=null;}
  else if((phaseChanged||panelOpened)&&state.panelOpen){restoreFocus(root,null,{fallbackSelectors:['.wf-panel']});pendingFocusBookmark=null;}
  else if(pendingFocusBookmark&&restoreFocus(root,pendingFocusBookmark)&&!state.busy)pendingFocusBookmark=null;
  previousPhase=state.phase;previousPanelOpen=state.panelOpen;
  if((phaseChanged||panelOpened)&&state.panelOpen){void motion.play(root.querySelector('.wf-panel'),[{opacity:0,transform:'translateX(7px)'},{opacity:1,transform:'none'}],{duration:160},{signal:listeners.signal,reduced:state.prefs.reduced||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true});}
  root.dataset.operationState=state.operation?.state || 'none';
  document.querySelector('#fixture').value=state.fixture;
  document.querySelector('#role').checked=state.isGM;
  const bottom=root.querySelector('.wf-character')?.getBoundingClientRect();
  const workspace=root.querySelector('.wf-workspace');
  if(workspace&&bottom)workspace.style.setProperty('--wf-bottom',`${Math.max(94,innerHeight-bottom.top+15)}px`);
  document.querySelectorAll('[data-map-select]').forEach(token=>{token.classList.toggle('selected',token.dataset.mapSelect===state.selectedId);token.hidden=state.fixture==='empty';});
  const targetButton=document.querySelector('[data-map-target]');
  targetButton.hidden=['hidden','empty'].includes(state.fixture);
  targetButton.classList.toggle('is-targeted',state.targetId==='guard');
  targetButton.setAttribute('aria-pressed',String(state.targetId==='guard'));
  targetButton.setAttribute('aria-label',state.targetId==='guard'?'Снять цель: охрана':'Выбрать цель: охрана');
}
async function refreshRecord(){
  state.resources=await ledger.load(state.namespace);
  if(state.resources.migratedFrom&&!state.notice)state.notice='Прежний общий демомагазин сохранён только у Прокси / винтовки. Остальные магазины заданы новой демосценой.';
  state.operation=state.requestId?await engine.publicView(state.requestId,{principal:principal()}):null;
  state.gmResult=null;
  if(state.isGM&&state.operation?.state==='resolved') {
    const record=await engine.getAuthorityRecord(state.requestId,{principal:principal()});
    // Private result is allowed here only for the GM fixture view, after resolution.
    state.gmResult={...record.result.private};
  }
}
const humanError=error=>({waiting:'Операция ждёт ответа защищающегося.',expired:'Срок выбора истёк. Автоматическое попадание не применяется.',rights:'Нет права на действие.',conflict:'Состояние изменилось. Сверьте сохранённую операцию.',uncertain:'Исход исполнения неизвестен. Нужна сверка квитанции.'}[error.code] || error.message || 'Действие не завершено.');
async function act(action) {
  if(state.busy)return;
  if(['attack','settings','gm','sdk-lab','recovery'].includes(action))rememberPanelOpener();
  state.busy=true;state.notice='';view();
  try {
    const data=model();
    switch(action) {
      case 'prepare':
        if(data.plan.status!=='ready')throw new Error('Подготовка заблокирована: исправьте отмеченные данные.');
        if(data.plan.defense.eligibility!=='eligible')throw new Error('Выбор защиты не подтверждён. Нужен разбор GM.');
        state.requestId=id('attack');
        state.operation=await engine.prepare({operation:'demo.redline.attack',args:{namespace:state.namespace,attackerId:data.selected.id,attackerName:data.selected.name,targetId:data.target.id,targetName:data.target.name,weaponId:data.weapon.id,weaponName:data.weapon.name,ammoKey:demoAmmoKey(data.selected.id,data.weapon.id),rangeDV:data.plan.dv.value,dvSource:data.plan.dv.source},requestId:state.requestId,principal:principal()});
        state.phase='defense';state.panelOpen=true;break;
      case 'evade':case 'accept':state.operation=await engine.decide(state.requestId,{choice:action,principal:principal()});state.phase='defense';state.notice='Решение записано. Исполнение ещё не начато.';break;
      case 'execute':state.operation=await engine.execute(state.requestId,{principal:principal()});state.phase=workflowPhaseForOperation(state.operation);if(state.phase==='recovery')state.notice='Исполнение не имеет подтверждённого результата. Нужна сверка.';break;
      case 'next-demo-turn':
        state.demoCombat=advanceDemoTurn(state.demoCombat,data.queue,state.operation);
        state.requestId=null;state.operation=null;state.gmResult=null;state.phase='prepare';state.panelOpen=true;
        state.notice='Продвинут только демоход. Выбранный токен и цель сохранены; Foundry Combat не изменён.';break;
      case 'recover':state.operation=await engine.recover(state.requestId,{principal:principal()});state.notice='Сохранённая операция сверена.';state.phase=workflowPhaseForOperation(state.operation);break;
      case 'reload':await refreshRecord();state.notice='Запись заново загружена из хранилища.';break;
      case 'cancel':state.operation=await engine.cancel(state.requestId,{principal:principal()});state.phase='recovery';break;
      case 'new':state.requestId=null;state.operation=null;state.phase='prepare';state.panelOpen=true;break;
      case 'attack':state.phase='prepare';state.panelOpen=true;break;
      case 'recovery':state.phase='recovery';state.panelOpen=true;break;
      case 'gm':state.phase='gm';state.panelOpen=true;break;
      case 'settings':state.phase=state.phase==='settings'?'prepare':'settings';state.panelOpen=true;break;
      case 'sdk-lab':state.phase='sdk-lab';state.panelOpen=true;break;
      case 'lab-outsider':labOutsider=!labOutsider;break;
      case 'lab-reset':reuse=createReusableDemo();labNonce=id('reuse');labLastId=null;labOutsider=false;state.notice='Демонстрации журнала и базы перезапущены в памяти.';break;
      case 'lab-radio':case 'lab-archive':{
        const choiceId=action==='lab-radio'?'radio':'archive';labLastId=`${labNonce}-journal-${choiceId}`;
        await reuse.engine.prepare({operation:'journal.choose',args:{journalId:'dossier',stageId:'arrival',choiceId},requestId:labLastId,principal:labPrincipal()});
        const result=await reuse.engine.execute(labLastId,{principal:labPrincipal()});state.notice=`Журнал: ${result.state==='resolved'?'ветка раскрыта по квитанции':'операция требует разбора'}`;break;
      }
      case 'lab-reserve':case 'lab-commit':case 'lab-release':{
        const name=action.slice(4);labLastId=`${labNonce}-base-${name}`;
        const args=name==='reserve'?{baseId:'workshop',resourceId:'parts',projectId:'antenna',quantity:2,steps:2,reservationId:'repair-1'}:{baseId:'workshop',reservationId:'repair-1'};
        await reuse.engine.prepare({operation:`base.${name}`,args,requestId:labLastId,principal:labPrincipal()});
        const result=await reuse.engine.execute(labLastId,{principal:labPrincipal()});state.notice=`База: ${result.state==='resolved'?'операция подтверждена квитанцией':'операция требует разбора'}`;break;
      }
      case 'lab-repeat':if(!labLastId)throw new Error('Сначала выполните операцию журнала или базы.');await reuse.engine.execute(labLastId,{principal:labPrincipal()});state.notice='Возвращена сохранённая квитанция без нового изменения.';break;
      case 'back':state.phase=state.operation?workflowPhaseForOperation(state.operation):'prepare';break;
      case 'collapse':state.prefs.collapsed=!state.prefs.collapsed;break;
      case 'close-panel':state.panelOpen=false;break;
      case 'manual-dv':
        state.manualOverride=commitDemoManualOverride({value:state.manualDV,source:state.manualSource},principal());
        state.requestId=null;state.operation=null;state.phase='prepare';state.notice='Ручное решение GM записано только для демоподготовки.';break;
      case 'reset-demo':state.namespace=id('encounter');state.demoCombat=createDemoTurnState();state.targetId='guard';state.requestId=null;state.operation=null;state.manualDV=null;state.manualSource='';state.manualOverride=null;state.phase='prepare';state.panelOpen=true;state.notice='Создан новый демосценарий. Прошлые квитанции сохранены.';break;
    }
    await refreshRecord();
  } catch(error){state.notice=humanError(error);if(state.requestId){try{await refreshRecord();if(state.operation&&!['waiting','ready'].includes(state.operation.state))state.phase=workflowPhaseForOperation(state.operation);}catch{}}}
  finally{state.busy=false;persist();view();}
}
const listeners=new AbortController(),options={signal:listeners.signal};
root.addEventListener('click',event=>{
  const selected=event.target.closest('[data-wf-select]');
  if(selected&&!selected.disabled&&!state.busy){state.selectedId=selected.dataset.wfSelect;persist();view();return;}
  const button=event.target.closest('[data-wf-action]');if(button&&!button.disabled)void act(button.dataset.wfAction);
},options);
root.addEventListener('change',event=>{
  const field=event.target.dataset.wfField;if(!field||state.busy)return;
  if(field==='weapon')state.weaponId=event.target.value;
  if(field==='scale'){const scale=Number(event.target.value);if([1,1.15,1.3].includes(scale))state.prefs.scale=scale;}
  if(['compact','reduced'].includes(field))state.prefs[field]=event.target.checked;
  if(field==='manualDV')state.manualDV=event.target.value===''?null:Number(event.target.value);
  if(field==='manualSource')state.manualSource=event.target.value.slice(0,160);
  persist();if(!field.startsWith('manual'))view();
},options);
document.querySelector('#fixture').addEventListener('change',event=>{if(state.busy)return;state.fixture=event.target.value;state.requestId=null;state.operation=null;state.manualDV=null;state.manualSource='';state.manualOverride=null;state.phase='prepare';state.panelOpen=true;persist();view();},options);
document.querySelector('#role').addEventListener('change',async event=>{state.isGM=event.target.checked;await refreshRecord();view();},options);
document.querySelector('#gm-view').addEventListener('click',()=>void act('gm'),options);
document.querySelector('#recovery-view').addEventListener('click',()=>void act('recovery'),options);
document.querySelector('#show-panel').addEventListener('click',()=>{rememberPanelOpener();state.panelOpen=true;view();},options);
document.querySelector('#reset-demo').addEventListener('click',()=>void act('reset-demo'),options);
document.querySelector('#sdk-lab').addEventListener('click',()=>void act('sdk-lab'),options);
document.querySelectorAll('[data-map-select]').forEach(button=>button.addEventListener('click',()=>{if(!state.busy){state.selectedId=button.dataset.mapSelect;persist();view();}},options));
document.querySelector('[data-map-target]').addEventListener('click',()=>{if(!state.busy){state.targetId=state.targetId==='guard'?null:'guard';persist();view();}},options);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){state.panelOpen=false;persist();view();}},options);
addEventListener('resize',view,options);
addEventListener('pagehide',event=>{if(!event.persisted){motion.dispose();pendingFocusBookmark=null;returnFocusBookmark=null;listeners.abort();engine.dispose();reuse.engine.dispose();void store.close().catch(()=>{});void ledger.close?.().catch(()=>{});}},{once:true});
async function start(){
  try{await refreshRecord();if(state.operation&&!['settings','gm','sdk-lab'].includes(state.phase))state.phase=workflowPhaseForOperation(state.operation);view();}
  catch(error){
    if(error.code==='demo-storage-corrupt'){root.textContent=`Стенд остановлен: ${error.message} Сохранённые данные не заменены.`;return;}
    if(error.code==='missing-data'&&state.resources){state.requestId=null;state.operation=null;state.phase='prepare';state.notice='Запись операции не найдена. Сохранённые деморесурсы не сброшены.';persist();view();return;}
    if(['unsupported','invalid-input','rights'].includes(error.code)&&state.resources){root.textContent=`Стенд остановлен: ${error.message} Сохранённые данные не заменены.`;return;}
    try{void store.close().catch(()=>{});void ledger.close?.().catch(()=>{});setupStorage(true);state.requestId=null;state.operation=null;state.phase='prepare';state.notice='Браузер не разрешил IndexedDB: демонстрация работает в памяти.';await refreshRecord();view();}
    catch(problem){root.innerHTML=`<p role="alert">Стенд не запущен: ${String(problem.message).replace(/[<>]/g,'')}</p>`;}
  }
}
void start();
