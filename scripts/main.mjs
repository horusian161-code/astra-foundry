import {Scope,RefreshScheduler} from './core/lifecycle.mjs';
import {DEFAULT_PREFS,normalizePreferences} from './core/contracts.mjs';
import {createReadModel,canOwnActor,isVisibleToken} from './adapters/cpr-read-model.mjs';
import {REDLINEApplication,updateHUD} from './ui/application-v1.mjs';
import {DEFAULT_ATTACK_DRAFT,preparationFromProjection,invalidatePreparationDraft,changePreparationField} from './adapters/preparation-port.mjs';
import {createModuleAPI} from './core/module-api.mjs';
import {NativeActionPort} from './adapters/native-action-port.mjs';
import * as components from './ui-kit/index.mjs';

const ID='astra-redline-combat';
let controller=null;
export class REDLINEController {
  constructor() { this.application=new REDLINEApplication(this);this.scope=null;this.scheduler=null;this.selectedTokenUuid=null;this.weaponId=null;this.panel=null;this.attackDraft={...DEFAULT_ATTACK_DRAFT}; }
  start() {
    if(this.scope) return;
    this.scope=new Scope();
    this.scheduler=new RefreshScheduler(()=>{if(this.application.rendered) { try { this.application.refresh(); } catch(error) { this.fail(error); } }});
    this.scope.track(()=>this.scheduler?.dispose());
    this.scope.hook(Hooks,'controlToken',(token,controlled)=>{const uuid=token.document?.uuid??null;if(controlled){if(uuid!==this.selectedTokenUuid){this.attackDraft={...DEFAULT_ATTACK_DRAFT};this.weaponId=null;}this.selectedTokenUuid=uuid;}else if(uuid===this.selectedTokenUuid){this.selectedTokenUuid=null;this.weaponId=null;this.attackDraft={...DEFAULT_ATTACK_DRAFT};}this.scheduler.request();});
    this.scope.hook(Hooks,'targetToken',(user)=>{if(user?.id===game.user?.id){this.attackDraft={...this.attackDraft,distanceConfirmed:false,cover:'unknown'};this.scheduler.request();}});
    this.scope.hook(Hooks,'canvasReady',()=>{this.selectedTokenUuid=null;this.weaponId=null;this.panel=null;this.attackDraft={...DEFAULT_ATTACK_DRAFT};this.scheduler.request();});
    this.scope.hook(Hooks,'canvasTearDown',()=>{this.selectedTokenUuid=null;this.weaponId=null;this.panel=null;this.attackDraft={...DEFAULT_ATTACK_DRAFT};this.scheduler.request();});
    for(const name of ['createCombat','updateCombat','deleteCombat','createCombatant','updateCombatant','deleteCombatant','updateActor','updateItem','createItem','deleteItem','updateToken','deleteToken','updateActiveEffect','createActiveEffect','deleteActiveEffect','renderSidebar','collapseSidebar','sightRefresh','visibilityRefresh','refreshToken','updateUser']) this.scope.hook(Hooks,name,document=>{if(this.panel==='prepare')this.attackDraft=invalidatePreparationDraft(this.attackDraft,name,document,this.snapshot());this.scheduler.request();});
    this.scope.listen(window,'resize',()=>this.scheduler.request());
  }
  snapshot() {
    return createReadModel({combat:game.combat,controlledTokens:canvas?.ready===false?[]:canvas?.tokens?.controlled,targetTokens:canvas?.ready===false?[]:game.user?.targets,sceneTokens:canvas?.ready===false?[]:canvas?.tokens?.placeables,sceneId:canvas?.scene?.id,user:game.user,system:game.system,selectedTokenUuid:this.selectedTokenUuid});
  }
  preferences() { return normalizePreferences(game.settings.get(ID,'preferences')); }
  fail(error) { console.error('REDLINE read-only UI failed',error);void this.close().catch(closeError=>console.warn('REDLINE close failed',closeError));ui.notifications?.warn('REDLINE отключён после ошибки чтения. Штатный трекер доступен.'); }
  attackPreview(options=this.attackDraft) { return preparationFromProjection(this.snapshot(),options,options?.weaponId??this.weaponId); }
  renderInto(root) {const model=this.snapshot();updateHUD(root,model,this.preferences(),{weaponId:this.weaponId,panel:this.panel,preparation:this.panel==='prepare'?preparationFromProjection(model,this.attackDraft,this.weaponId):null},this.application.motion);}
  async open() { this.start();this.application.render(true);return true; }
  stop() { this.scope?.dispose();this.scope=null;this.scheduler=null; }
  async close() { await this.application.close();return false; }
  async toggle() { return this.application.rendered ? this.close() : this.open(); }
  async onClick(event) {
    if(event.detail>1) return;
    const tokenButton=event.target.closest('[data-rl-token]');
    if(tokenButton && !tokenButton.disabled) {
      const token=canvas?.tokens?.placeables?.find(t=>t.document?.uuid===tokenButton.dataset.rlToken);
      if(token && isVisibleToken(token,game.user,canvas?.scene?.id) && canOwnActor(token.actor,game.user)) token.control({releaseOthers:true});
      return;
    }
    const button=event.target.closest('[data-rl-action]');if(!button||button.disabled)return;
    switch(button.dataset.rlAction) {
      case 'hide':await this.close();return;
      case 'tracker':ui.sidebar?.activateTab?.('combat');ui.combat?.render?.(true);return;
      case 'actor-sheet': {
        const selected=this.snapshot().selected;
        const token=canvas?.tokens?.placeables?.find(t=>t.document?.uuid===selected?.tokenUuid);
        if(token && canOwnActor(token.actor,game.user)) token.actor.sheet?.render(true);
        return;
      }
      case 'settings':this.panel=this.panel==='settings'?null:'settings';break;
      case 'details':this.panel=this.panel==='details'?null:'details';break;
      case 'prepare':this.panel='prepare';break;
      case 'close-panel':this.panel=null;break;
      case 'collapse':await this.savePreferences({collapsed:!this.preferences().collapsed});return;
      default:return;
    }
    this.application.refresh();
  }
  async onChange(event) {
    if(event.target.matches('[data-rl-attack-field]')) {this.setAttackField(event.target);this.application.refresh();return;}
    if(event.target.matches('[data-rl-weapon]')) {this.weaponId=event.target.value;this.attackDraft={...DEFAULT_ATTACK_DRAFT};this.application.refresh();return;}
    if(!event.target.matches('[data-rl-pref]'))return;
    const key=event.target.dataset.rlPref;
    if(!['compact','scale','dock','reduced'].includes(key))return;
    const value=event.target.type==='checkbox'?event.target.checked:key==='scale'?Number(event.target.value):event.target.value;
    await this.savePreferences({[key]:value});
  }
  setAttackField(target) { const key=target.dataset.rlAttackField;const value=target.type==='checkbox'?target.checked:String(target.value).slice(0,256);this.attackDraft=changePreparationField(this.attackDraft,key,value); }
  async onInput(event) {if(event.target.matches('[data-rl-attack-field]'))this.setAttackField(event.target);}
  async savePreferences(patch) {
    // Scope is client. No world settings, flags or Actor/Item/Combat writes.
    try {await game.settings.set(ID,'preferences',normalizePreferences({...this.preferences(),...patch}));}
    catch(error){ui.notifications?.warn('REDLINE: не удалось сохранить настройки клиента.');console.warn('REDLINE client preferences',error);}
    this.application.refresh();
  }
}

Hooks.once('init',()=>{
  game.settings.register(ID,'preferences',{name:'REDLINE: настройки клиента',hint:'Только локальные положение, плотность, масштаб и сворачивание HUD.',scope:'client',config:false,type:Object,default:{...DEFAULT_PREFS}});
  game.settings.register(ID,'autoOpen',{name:'REDLINE: открывать HUD при входе',hint:'Отключите для использования только Astra SDK. Shift+H открывает HUD вручную.',scope:'client',config:true,type:Boolean,default:true});
  game.keybindings.register(ID,'toggle',{name:'Показать / скрыть REDLINE',editable:[{key:'KeyH',modifiers:['Shift']}],onDown:()=>{void controller?.toggle();return true;},restricted:false});
});
Hooks.on('getSceneControlButtons',controls=>{
  const tokens=controls.find(control=>control.name==='token');
  if(!tokens)return;
  if(tokens.tools.some(tool=>tool.name===ID))return;
  tokens.tools.push({name:ID,title:'REDLINE COMBAT · Preparation Alpha',icon:'fas fa-crosshairs',button:true,onClick:()=>controller?.toggle()});
});
Hooks.once('ready',()=>{
  if(game.release?.generation!==12) {ui.notifications.warn('REDLINE alpha предназначен для Foundry v12. Интерфейс не запущен.');return;}
  controller=new REDLINEController();
  const nativePort=new NativeActionPort({resolveCurrentSelection:async()=>({token:canvas?.tokens?.placeables?.find(token=>token.document?.uuid===controller.snapshot().selected?.tokenUuid),user:game.user,sceneId:canvas?.scene?.id}),getRuntimeProfile:async()=>({profileId:game.system?.version==='v0.89.2'?'cpr-v0.89.2-study':game.system?.version==='v0.92.4'?'cpr-v0.92.4-study':'unsupported',systemId:game.system?.id,systemVersion:game.system?.version,foundryGeneration:game.release?.generation,foundryBuild:String(game.release?.build??''),worldId:game.world?.id,userId:game.user?.id})});
  game.modules.get(ID).api=createModuleAPI({controller,getCurrentUser:()=>game.user,components,nativePort});
  if(game.system.id!=='cyberpunk-red-core')ui.notifications.warn('REDLINE: система отличается от CPR; ресурсы и оружие недоступны.');
  if(game.settings.get(ID,'autoOpen'))void controller.open();
});
