import {collectionValues, scalarNumber} from '../core/lifecycle.mjs';

export const CPR_SYSTEM_ID = 'cyberpunk-red-core';
export const ADAPTER_VERSION = '0.2.0-readonly';
export const MUTATION_REASON = 'Системные сигнатуры и правила исполнения ещё не проверены. Используйте родной лист персонажа и штатный трекер.';
const idOf = document => document?.id ?? document?._id ?? null;
const uuidOf = document => typeof document?.uuid === 'string' ? document.uuid : null;
const text = value => typeof value === 'string' ? value : '';
const tokenDocument = token => token?.document ?? token;
export const canOwnActor = (actor, user) => {
  if (!actor || !user) return false;
  if (user.isGM) return true;
  if (typeof actor.testUserPermission !== 'function') return false;
  try { return actor.testUserPermission(user, 'OWNER') === true; } catch { return false; }
};
export const isVisibleToken = (token, user, sceneId) => {
  if (!token || !user) return false;
  const document = tokenDocument(token);
  if (sceneId && document?.parent?.id !== sceneId) return false;
  if (!user.isGM && document?.hidden === true) return false;
  return user.isGM || token.visible === true;
};
const imageOf = (token, actor, own) => text(tokenDocument(token)?.texture?.src) || (own ? text(actor?.img) : '');
const identity = (token, user) => {
  const document = tokenDocument(token), actor = token?.actor ?? document?.actor;
  const own = canOwnActor(actor, user);
  return {tokenId: idOf(document), tokenUuid: uuidOf(document), actorUuid: own ? uuidOf(actor) : null,
    name: text(document?.name) || (own ? text(actor?.name) : '') || 'Участник', image: imageOf(token, actor, own), own};
};
const resource = object => ({value: scalarNumber(object?.value), max: scalarNumber(object?.max)});
const resolveEquipped = actor => {
  const equipped = actor?.system?.weapons?.equipped;
  if (Array.isArray(equipped)) return equipped.map(item => typeof item === 'string' ? actor.items?.get?.(item) : item).filter(Boolean);
  return collectionValues(actor?.items).filter(item => item?.type === 'weapon' && item?.system?.equipped === 'equipped');
};
const weaponModel = item => ({id: idOf(item), uuid: uuidOf(item), name: text(item.name) || 'Без названия',
  damage: text(item.system?.damage) || null, rof: scalarNumber(item.system?.rof),
  ranged: item.system?.isRanged === true, weaponType: text(item.system?.weaponType) || null, magazine: resource(item.system?.magazine),
  ammoName: text(item.system?.loadedAmmo?.name),
  source: 'native Actor/Item read model; damage is stored text, not a calculated roll'});
const WOUND_LABELS = {notWounded:'Без ранений', lightlyWounded:'Легко ранен', seriouslyWounded:'Тяжело ранен', mortallyWounded:'Смертельно ранен', dead:'Мёртв', invalidState:'Состояние не определено'};

export function readOwnedActor(actor, user, system) {
  if (!canOwnActor(actor, user)) return null;
  if (system?.id !== CPR_SYSTEM_ID) return {supported:false, reason:'Активная система отличается от cyberpunk-red-core.', resources:null, weapons:[], statuses:[]};
  const native = actor.system ?? {}, derived = native.derivedStats ?? {}, external = native.externalData ?? {};
  const woundCode = text(derived.currentWoundState);
  return {supported:true, actorUuid:uuidOf(actor), actorType:text(actor.type), sourceSystemVersion:text(system.version),
    resources:{hp:resource(derived.hp), head:resource(external.currentArmorHead), body:resource(external.currentArmorBody), shield:resource(external.currentArmorShield), luck:resource(native.stats?.luck)},
    stats:{ref:scalarNumber(native.stats?.ref?.value)},
    wound:{code:woundCode || null, label:WOUND_LABELS[woundCode] ?? (woundCode || 'Нет данных о ранениях')},
    weapons:resolveEquipped(actor).map(weaponModel),
    statuses:collectionValues(actor.statuses).filter(value=>typeof value==='string'),
    reason:'Только чтение полей системы. Точная версия и исполнение операций ещё не сертифицированы.'};
}

/** Plain-data projection. No Actor, Item, Token or private Actor payload escapes. */
export function createReadModel({combat, controlledTokens, targetTokens, sceneTokens, sceneId, user, system, selectedTokenUuid=null}) {
  const tokenList=collectionValues(sceneTokens), controlled=collectionValues(controlledTokens);
  const ownVisible=controlled.filter(token=>isVisibleToken(token,user,sceneId)&&canOwnActor(token?.actor ?? tokenDocument(token)?.actor,user));
  const subject=ownVisible.find(token=>uuidOf(tokenDocument(token))===selectedTokenUuid) ?? ownVisible.at(-1) ?? null;
  const selected=subject ? {...identity(subject,user), detail:readOwnedActor(subject.actor ?? tokenDocument(subject)?.actor,user,system)} : null;
  const targets=collectionValues(targetTokens).filter(token=>isVisibleToken(token,user,sceneId)).map(token=>{
    const projected=identity(token,user);
    return {...projected, detail:projected.own ? readOwnedActor(token.actor ?? tokenDocument(token)?.actor,user,system) : null};
  });
  const nativeTurns=Array.isArray(combat?.turns) ? combat.turns : [];
  const projected = new Map();
  const queue=[];
  for(const combatant of nativeTurns) {
    if(!user?.isGM && combatant?.hidden===true) continue;
    const document=combatant?.token;
    const combatSceneId=combat?.scene?.id ?? document?.parent?.id ?? null;
    if(sceneId && combatSceneId && combatSceneId!==sceneId && !user?.isGM) continue;
    const token=tokenList.find(t=>uuidOf(document) ? uuidOf(tokenDocument(t))===uuidOf(document) : idOf(tokenDocument(t))===idOf(document)&&tokenDocument(t)?.parent?.id===document?.parent?.id);
    if (!token || !isVisibleToken(token,user,sceneId)) {
      if (!user?.isGM) continue;
      const actor=combatant?.actor;
      const row={id:idOf(combatant),uuid:uuidOf(combatant),tokenId:idOf(document),tokenUuid:uuidOf(document),actorUuid:uuidOf(actor),
        name:text(combatant.name)||text(actor?.name)||'Участник без токена',image:text(combatant.img)||text(actor?.img),own:false,
        initiative:scalarNumber(combatant.initiative),defeated:combatant.defeated===true,hidden:combatant.hidden===true,unavailableToken:true};
      projected.set(row.id,row);queue.push(row);continue;
    }
    const visible=identity(token,user);
    const row={id:idOf(combatant), uuid:uuidOf(combatant), ...visible,
      initiative:scalarNumber(combatant.initiative), defeated:combatant.defeated===true,
      hidden:user?.isGM ? combatant.hidden===true : false};
    projected.set(row.id,row);queue.push(row);
  }
  const currentCombatant=combat?.combatant ?? (Number.isInteger(combat?.turn) ? nativeTurns[combat.turn] : null);
  const currentId=projected.has(idOf(currentCombatant)) ? idOf(currentCombatant) : null;
  // Native getter owns skip-defeated and other core tracker policy. No modulo fallback.
  const nextNative=combat?.nextCombatant ?? null;
  const nextId=projected.has(idOf(nextNative)) ? idOf(nextNative) : null;
  for(const row of queue) {
    row.current=row.id===currentId;row.next=row.id===nextId;
    row.selected=Boolean(selected && row.tokenUuid===selected.tokenUuid);
    row.targeted=targets.some(target=>target.tokenUuid===row.tokenUuid);
  }
  return {schemaVersion:1, adapterVersion:ADAPTER_VERSION, system:{id:text(system?.id),version:text(system?.version)},
    sceneId:sceneId ?? null, combat:combat ? {uuid:uuidOf(combat),round:scalarNumber(combat.round),started:combat.started===true,currentId,nextId} : null,
    selected,targets,queue, capabilities:{readOnly:true,attackPrepare:true,nativeRoll:false,damageApply:false,nextTurn:false,mutationReason:MUTATION_REASON},
    projectionPolicy:'owned-visible selected tokens; visible combatants and targets; exact actor resources require OWNER or GM'};
}
