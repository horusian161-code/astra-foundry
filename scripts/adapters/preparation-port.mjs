import {prepareAttack} from './cpr-attack-plan.mjs';

export const DEFAULT_ATTACK_DRAFT=Object.freeze({targetUuid:'',distance:'',distanceConfirmed:false,cover:'unknown',modifier:'0',modifiersReviewed:false,profileReviewed:false});
export function changePreparationField(draft,key,value) {
  if(!Object.hasOwn(DEFAULT_ATTACK_DRAFT,key))return {...draft};
  const next={...draft,[key]:value};
  if(value!==draft[key]) {
    if(key==='targetUuid'){next.distanceConfirmed=false;next.cover='unknown';}
    if(key==='distance')next.distanceConfirmed=false;
    if(key==='modifier')next.modifiersReviewed=false;
  }
  return next;
}
const boundedText=(value,max=256)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f]/.test(value)?value:'';
const strictNumber=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&/^\s*-?\d+(?:\.\d+)?\s*$/.test(value)&&value.length<=20?Number(value):null;
const family=value=>value==='assaultRifle'?'assaultRifle':['pistol','mediumPistol','heavyPistol','veryHeavyPistol'].includes(value)?'pistol':null;

/** Manual confirmations become stale when their relevant native subjects change. */
export function invalidatePreparationDraft(draft,event,document,model) {
  const next={...draft}, selected=model?.selected;
  if(['updateToken','deleteToken'].includes(event)) {
    const ids=[selected?.tokenUuid,...(model?.targets??[]).map(t=>t.tokenUuid),draft.targetUuid];
    if(document?.uuid&&ids.includes(document.uuid)){next.distanceConfirmed=false;next.cover='unknown';}
  }
  const actorChanged=event==='updateActor'&&document?.uuid&&document.uuid===selected?.actorUuid;
  const childChanged=['updateItem','createItem','deleteItem','updateActiveEffect','createActiveEffect','deleteActiveEffect'].includes(event)&&document?.parent?.uuid&&document.parent.uuid===selected?.actorUuid;
  if(actorChanged||childChanged){next.modifiersReviewed=false;next.profileReviewed=false;}
  return next;
}

/** Constructs plain preview input from the CURRENT permission-filtered projection.
 * Callers cannot supply an actor, permission assertion, hidden target or enemy REF.
 * All range/modifier inputs remain explicitly manual; they never authorise a roll.
 */
export function preparationFromProjection(model,options={},weaponId=null) {
  const draft={...DEFAULT_ATTACK_DRAFT};
  for(const key of ['targetUuid','distance','modifier'])draft[key]=typeof options?.[key]==='number'?String(options[key]):boundedText(options?.[key]??draft[key]);
  draft.distanceConfirmed=options?.distanceConfirmed===true;
  draft.modifiersReviewed=options?.modifiersReviewed===true;
  draft.profileReviewed=options?.profileReviewed===true;
  draft.cover=['unknown','clear','blocked'].includes(options?.cover)?options.cover:'unknown';
  const selected=model?.selected, detail=selected?.detail;
  const weapons=detail?.weapons??[];
  // A stale explicit weapon must block instead of silently changing the attack.
  const weapon=weaponId?weapons.find(w=>w.id===weaponId):weapons[0];
  const targets=model?.targets??[];
  const target=draft.targetUuid?targets.find(t=>t.tokenUuid===draft.targetUuid):targets.length===1?targets[0]:null;
  const owner=selected?.own===true&&detail?.supported===true;
  const input={
    attacker:{id:owner?selected.tokenUuid:null,owner,visible:!!selected},
    weapon:weapon?{id:weapon.id,kind:family(weapon.weaponType),ranged:weapon.ranged===true,profileVerified:draft.profileReviewed,rof:weapon.rof,magazine:{value:weapon.magazine?.value??null,max:weapon.magazine?.max??null}}:null,
    target:target?{id:target.tokenUuid,visible:true,cover:draft.cover,defense:{dataAuthorized:target.own===true,reflex:target.detail?.stats?.ref??null,aware:null,canDodge:null,exception:'unknown'}}:null,
    distance:{value:strictNumber(draft.distance),unit:'m',source:'manual',measurementVerified:draft.distanceConfirmed},
    mode:'single',modifiers:[{id:'manual-review',label:'Проверенные вручную модификаторы',value:strictNumber(draft.modifier),checked:draft.modifiersReviewed,source:'Ввод текущего пользователя; нативная формула не проверена'}],
    modifiersComplete:draft.modifiersReviewed
  };
  const plan=prepareAttack(input);
  return {draft,plan,weaponName:weapon?.name??null,targetName:target?.name??null,
    scope:'Native documents read only; manual preview; no system roll or resource expenditure',
    systemVersion:model?.system?.version??null};
}
