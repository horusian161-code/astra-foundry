import {canonicalPayload} from '../sdk/canonical.mjs';

export const NATIVE_ACTION_PORT_VERSION='0.3.0-scaffold';
export const NATIVE_ACTION_OPERATIONS=Object.freeze(['weapon.attack','weapon.reload','damage.apply']);
const CAPABILITIES=Object.freeze({nativeRoll:false,reload:false,damageApply:false,ammoChange:false,distributedExecution:false});
const source=(version,path)=>`https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/raw/${version}/src/${path}`;
/** Source-study records are not executable capabilities. No executable native profile is shipped. */
export const NATIVE_ACTION_STUDY_PROFILES=Object.freeze([
  Object.freeze({id:'cpr-v0.89.2-study',systemId:'cyberpunk-red-core',systemVersion:'v0.89.2',foundryGeneration:12,
    executable:false,liveAccepted:false,source:source('v0.89.2','modules/api/initialize.js')}),
  Object.freeze({id:'cpr-v0.92.4-study',systemId:'cyberpunk-red-core',systemVersion:'v0.92.4',foundryGeneration:12,
    executable:false,liveAccepted:false,source:source('v0.92.4','modules/api/initialize.js')})
]);
const REASONS=Object.freeze({
  'invalid-input':'Некорректные аргументы. Принимаются только идентификаторы и поддержанные действия; права и профили задаёт интеграционный порт.',
  'no-selection':'Нет выбранного токена с персонажем.',
  'stale-selection':'Выбранный токен изменился. Повторите подготовку для текущего персонажа.',
  'wrong-scene':'Токен не принадлежит текущей сцене.',
  'hidden-selection':'Токен недоступен в текущем представлении.',
  'rights':'Нужно право OWNER на персонажа текущего токена.',
  'item-missing':'Оружие не найдено в текущем персонаже. Мировой предмет или устаревший ID не подходит.',
  'item-not-weapon':'Этот предмет не является поддержанным обычным оружием.',
  'provider-unavailable':'Нельзя проверить текущее окружение или права. Исполнение остановлено.',
  'profile-missing':'Точная версия Foundry/CPR, мир и текущий пользователь не подтверждены доверенным провайдером.',
  'profile-mismatch':'Профиль не совпадает с точным окружением или текущим пользователем. Версии по диапазону не допускаются.',
  'unsupported-native-api':'Для этого окружения нет включённого и проверенного публичного API операции. Используйте родной лист и карточку системы.',
  'sheet-unavailable':'Родной лист персонажа недоступен.',
  'sheet-failed':'Запрос открытия родного листа не завершён. Исполнение игровых действий не запускалось.'
});
const identifier=(value,max=128)=>typeof value==='string'&&value.length>0&&value.length<=max&&/^[A-Za-z0-9_.:-]+$/u.test(value);
const tokenUuid=value=>typeof value==='string'&&/^Scene\.[A-Za-z0-9_-]{1,64}\.Token\.[A-Za-z0-9_-]{1,64}$/u.test(value);
const text=(value,max=256)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value)?value:null;
const blocked=(code,operation=null,extra={})=>({status:'blocked',operation,reason:{code,message:REASONS[code]},
  capabilities:{...CAPABILITIES},provenNoGameMutation:true,...extra});
const sheetAvailable=actor=>{try{return typeof actor.sheet?.render==='function';}catch{return false;}};
function boundedRequest(input) {
  try {
    const args=JSON.parse(canonicalPayload(input,{maxLength:2048,maxDepth:2,maxNodes:16}));
    if(!args||typeof args!=='object'||Array.isArray(args))return null;
    if(Object.keys(args).some(key=>!['operation','tokenUuid','weaponId','mode'].includes(key)))return null;
    if(!NATIVE_ACTION_OPERATIONS.includes(args.operation))return null;
    if(args.tokenUuid!==undefined&&!tokenUuid(args.tokenUuid))return null;
    if(args.weaponId!==undefined&&(!identifier(args.weaponId)||args.weaponId.includes('.')))return null;
    if(args.mode!==undefined&&(args.operation!=='weapon.attack'||args.mode!=='single'))return null;
    if(args.operation!=='damage.apply'&&!identifier(args.weaponId))return null;
    if(args.operation==='damage.apply'&&args.weaponId!==undefined)return null;
    return args;
  } catch{return null;}
}
function currentSubject(context,args) {
  const token=context?.token,document=token?.document??token,actor=token?.actor??document?.actor,user=context?.user;
  if(!token||!actor||!user||!tokenUuid(document?.uuid)||!identifier(user?.id))return {code:'no-selection'};
  if(args.tokenUuid!==undefined&&args.tokenUuid!==document.uuid)return {code:'stale-selection'};
  if(!identifier(context?.sceneId)||document?.parent?.id!==context.sceneId)return {code:'wrong-scene'};
  if(!user.isGM&&(document.hidden===true||token.visible!==true))return {code:'hidden-selection'};
  let owner=false;
  try {owner=user.isGM===true||actor.testUserPermission?.(user,'OWNER')===true;}catch{return {code:'rights'};}
  if(!owner)return {code:'rights'};
  // Resolve only the current token actor's embedded collection; never fromUuid/game.items.
  let item=null;
  if(args.operation!=='damage.apply') {
    try {item=actor.items?.get?.(args.weaponId)??null;}catch{return {code:'item-missing'};}
    if(!item||item.id!==args.weaponId||item.parent!==actor)return {code:'item-missing'};
    if(item.type!=='weapon')return {code:'item-not-weapon'};
  }
  return {actor,item,user,token:document,sceneId:context.sceneId,
    public:{tokenUuid:document.uuid,actorUuid:text(actor.uuid),weaponId:item?.id??null,name:text(document.name)??text(actor.name)??'Персонаж'}};
}
function runtimeRecord(raw,subject) {
  let runtime;
  try {runtime=JSON.parse(canonicalPayload(raw,{maxLength:4096,maxDepth:3,maxNodes:48}));}catch{return {code:'profile-missing'};}
  if(!runtime||typeof runtime!=='object'||Array.isArray(runtime)||!identifier(runtime.profileId)
    ||!identifier(runtime.systemId)||!identifier(runtime.systemVersion)||runtime.foundryGeneration!==12
    ||typeof runtime.foundryBuild!=='string'||!/^[0-9]{3,5}$/u.test(runtime.foundryBuild)
    ||!identifier(runtime.worldId)||!identifier(runtime.userId))return {code:'profile-missing'};
  const profile=NATIVE_ACTION_STUDY_PROFILES.find(p=>p.id===runtime.profileId);
  if(!profile||profile.systemId!==runtime.systemId||profile.systemVersion!==runtime.systemVersion
    ||profile.foundryGeneration!==runtime.foundryGeneration||runtime.userId!==subject.user.id)return {code:'profile-mismatch'};
  return {profile,runtime:{profileId:profile.id,systemId:runtime.systemId,systemVersion:runtime.systemVersion,
    foundryGeneration:runtime.foundryGeneration,foundryBuild:runtime.foundryBuild,worldId:runtime.worldId,
    executable:false,liveAccepted:false}};
}
/** Fail-closed port. Its providers are supplied by module code, never by an operation request.
 * Current release ships source-study profiles only and cannot call a gameplay entrypoint.
 */
export class NativeActionPort {
  #resolveCurrentSelection;#getRuntimeProfile;
  constructor({resolveCurrentSelection=async()=>null,getRuntimeProfile=async()=>null}={}) {
    if(typeof resolveCurrentSelection!=='function'||typeof getRuntimeProfile!=='function')throw new TypeError('NativeActionPort providers must be functions');
    this.#resolveCurrentSelection=resolveCurrentSelection;this.#getRuntimeProfile=getRuntimeProfile;
  }
  async prepare(input) {
    const args=boundedRequest(input);
    if(!args)return blocked('invalid-input');
    let raw,context;
    try {raw=await this.#getRuntimeProfile();context=await this.#resolveCurrentSelection();}
    catch{return blocked('provider-unavailable',args.operation);}
    let subject;
    try {subject=currentSubject(context,args);}catch{return blocked('provider-unavailable',args.operation);}
    if(subject.code)return blocked(subject.code,args.operation);
    const fallback={id:'actor-sheet',available:sheetAvailable(subject.actor),automatic:false};
    const resolved=runtimeRecord(raw,subject);
    if(resolved.code)return blocked(resolved.code,args.operation,{subject:subject.public,fallback});
    return blocked('unsupported-native-api',args.operation,{subject:subject.public,runtime:resolved.runtime,fallback,
      verification:{sourceStudied:true,publicGameplayAPI:false,liveTested:false,cancelOutcomeCertified:false,onceOnlyCertified:false}});
  }
  async execute(input) {
    // Re-resolve every attempt. A previous preview and caller-supplied verified=true never unlock an operation.
    return this.prepare(input);
  }
  async openFallback(input) {
    const args=boundedRequest(input);
    if(!args)return blocked('invalid-input');
    let context;
    try {context=await this.#resolveCurrentSelection();}catch{return blocked('provider-unavailable',args.operation);}
    let subject;
    try {subject=currentSubject(context,args);}catch{return blocked('provider-unavailable',args.operation);}
    if(subject.code)return blocked(subject.code,args.operation);
    if(!sheetAvailable(subject.actor))return blocked('sheet-unavailable',args.operation);
    try {
      // Public Foundry Application UI entrypoint; no game roll or document mutation is dispatched.
      await subject.actor.sheet.render(true);
      return {status:'requested',operation:'ui.actorSheet',subject:subject.public,capabilities:{...CAPABILITIES},
        gameplayDispatched:false,provenNoGameMutation:false};
    }catch{return blocked('sheet-failed',args.operation,{gameplayDispatched:false,provenNoGameMutation:false});}
  }
}
