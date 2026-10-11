/** CPR attack preparation only. No Foundry globals, dice, sockets or document writes.
 * `ready` means the preview has enough data, never permission to execute a game action.
 * Inputs must already be projected for the requesting user by the integration port.
 */
export const ATTACK_PLAN_VERSION = '0.2.0-preview';
export const CPR_RULE_SOURCES = Object.freeze({
  range: 'https://roll20.net/compendium/cpunk/Playing%20the%20Game',
  defense: 'https://rtalsoriangames.com/wp-content/uploads/2021/07/RTG-CPR-CoreBookFAQv1.3.pdf',
  aimed: 'https://rtalsoriangames.com/wp-content/uploads/2024/07/RTG-CPR-DLC-Edgerunner-Folio-Form-Fillable.pdf',
  measurement: 'https://foundryvtt.com/api/v12/classes/foundry.grid.BaseGrid.html'
});
const RANGE_BANDS = Object.freeze([
  [0, 6], [7, 12], [13, 25], [26, 50], [51, 100], [101, 200], [201, 400], [401, 800]
].map(Object.freeze));
const RANGE_DVS = Object.freeze({
  pistol: Object.freeze([13, 15, 20, 25, 30, 30, null, null]),
  assaultRifle: Object.freeze([17, 16, 15, 13, 15, 20, 25, 30])
});
const CAPABILITIES = Object.freeze({preview:true,nativeRoll:false,ammoChange:false,damageApply:false,distributedExecution:false});
const REASON = Object.freeze({
  invalidInput:'Нужны ограниченные обычные данные без документов, функций и вычисляемых свойств.',
  noAttacker:'Выберите персонажа.', noOwner:'Нет доступа OWNER к выбранному персонажу.',
  hiddenAttacker:'Выбранный персонаж не виден в текущей сцене.', noWeapon:'Выберите оружие.',
  unsupportedWeapon:'В alpha поддержан только обычный одиночный выстрел из пистолета или штурмовой винтовки.',
  unknownWeaponProfile:'Обычный профиль одиночного выстрела и расход одного патрона не подтверждены. Special/exotic оружие требует отдельной проверки.',
  unknownROF:'Неизвестен ROF оружия.', unknownAmmo:'Нет достоверных данных о боезапасе.', emptyMagazine:'Магазин пуст.',
  invalidMagazine:'Боезапас выше указанной ёмкости; проверьте эффективную ёмкость с учётом улучшений.', noTarget:'Выберите одну цель.', hiddenTarget:'Цель недоступна в текущем представлении.',
  coverBlocked:'Полная преграда блокирует обычный прямой выстрел по персонажу. Атака укрытия — отдельная операция.',
  coverUnknown:'Положение относительно укрытия не подтверждено. Требуется решение GM.',
  unknownDistance:'Дистанция не подтверждена.', invalidDistance:'Дистанция должна быть конечным неотрицательным числом в м/ярдах.',
  fractionalDistance:'Нужно подтверждённое целое расстояние: правило распределения дробной дистанции по диапазонам ещё не проверено.',
  unknownDV:'Для этой дистанции и оружия нет поддержанного DV. Исправьте данные или разрешите ситуацию через GM.',
  unsupportedMode:'Выбранный режим ещё не поддержан этой alpha.',
  invalidModifiers:'Список модификаторов содержит некорректные или повторяющиеся записи.',
  uncheckedModifiers:'Не все применяемые модификаторы подтверждены.',
  invalidModifierTotal:'Сумма модификаторов выходит за допустимые границы предпросмотра.'
});
const plain = v => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const string = (v,max=256) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v) ? v : null;
const integer = (v,min,max) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
/** Reject surprising accessors/prototypes and enforce an input budget before examining fields. */
function boundedData(input) {
  let nodes=0;
  const visit=(value,depth)=>{
    if(++nodes>512 || depth>8) return false;
    if(value===null || typeof value==='boolean') return true;
    if(typeof value==='number') return Number.isFinite(value) && Math.abs(value)<=1000000;
    if(typeof value==='string') return value.length<=512 && !/[\u0000-\u001f\u007f]/u.test(value);
    if(Array.isArray(value)) {
      if(Object.getPrototypeOf(value)!==Array.prototype||value.length>64) return false;
      const descriptors=Object.getOwnPropertyDescriptors(value);
      if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string'||(key!=='length'&&!/^(0|[1-9][0-9]*)$/u.test(key)))) return false;
      for(let i=0;i<value.length;i++) {
        const descriptor=descriptors[String(i)];
        if(!descriptor||!('value' in descriptor)||!visit(descriptor.value,depth+1)) return false;
      }
      return true;
    }
    if(!plain(value)) return false;
    const descriptors=Object.getOwnPropertyDescriptors(value);
    if(Reflect.ownKeys(descriptors).some(key=>typeof key!=='string')) return false;
    return Object.keys(descriptors).length<=32 && Object.entries(descriptors).every(([key,d])=>
      key.length<=64 && !['__proto__','prototype','constructor'].includes(key) && 'value' in d && visit(d.value,depth+1));
  };
  try {return plain(input) && visit(input,0);} catch {return false;}
}
function modeModels(supported) {
  return [
    {id:'single',label:'Одиночный выстрел',supported,attackChecks:1,reason:supported?null:REASON.unsupportedWeapon},
    {id:'aimed',label:'Прицельная атака',supported:false,ruleModifier:-8,rof:1,locations:['head','heldItem','leg'],
      reason:'Правило −8 / ROF 1 подтверждено; последствия выбранной зоны и системное исполнение ещё не подключены.',source:CPR_RULE_SOURCES.aimed},
    {id:'autofire',label:'Автоматический огонь',supported:false,reason:'Нужны отдельные DV, расход и правила; в эту alpha не входят.'},
    {id:'suppressive',label:'Подавляющий огонь',supported:false,reason:'Это отдельный процесс, ещё не подключён.'}
  ];
}
function defenseModel(target) {
  const evidence=plain(target?.defense) && target.defense.dataAuthorized===true ? target.defense : null;
  const base={eligibility:'unknown',needsGM:true,options:[],opposedDV:null,executionAllowed:false,
    timing:'declare-and-roll-before-attack',source:CPR_RULE_SOURCES.defense,
    reason:'Право на уклонение не подтверждено для этого пользователя. Запросить GM; неизвестное значение не означает попадание.'};
  if(!evidence) return base;
  if(evidence.canDodge===false || evidence.aware===false) return {...base,eligibility:'ineligible',needsGM:false,options:['range'],
    reason:evidence.canDodge===false?'Подтверждено ограничение на уклонение.':'Подтверждено, что цель не воспринимает атаку.'};
  // Additional cyberware/ruleset exceptions are not interpreted as the ordinary REF-8 rule.
  if(evidence.exception!=='none') return {...base,reason:'Исключение из правила REF 8 требует проверки GM и выбранного набора правил.'};
  if(!integer(evidence.reflex,0,20)) return base;
  if(evidence.reflex<8) return {...base,eligibility:'ineligible',needsGM:false,options:['range'],reason:'Обычное условие REF 8 не выполнено; исключения явно отсутствуют.'};
  if(evidence.aware!==true || evidence.canDodge!==true) return base;
  return {...base,eligibility:'eligible',needsGM:false,options:['range','evade'],reason:'Обычное условие REF 8 выполнено; выбор и бросок Evasion должны предшествовать атаке.'};
}
/**
 * Pure bounded preview. `modifiersComplete` acknowledges review of system/situational modifiers;
 * it does not certify the Foundry roll formula. Unauthorised defender data is never returned.
 */
export function prepareAttack(input) {
  const reasons=[];
  const add=(code,field)=>{if(!reasons.some(r=>r.code===code&&r.field===field)) reasons.push({code,field,message:REASON[code]});};
  if(!boundedData(input)) return {schemaVersion:1,adapterVersion:ATTACK_PLAN_VERSION,status:'blocked',
    reasons:[{code:'invalidInput',field:'input',message:REASON.invalidInput}],distance:null,
    dv:{value:null,source:'unknown',table:null,bandLabel:null,conditional:true},allowedModes:modeModels(false),costs:null,
    defense:defenseModel(null),modifiers:{entries:[],total:null,complete:false},capabilities:{...CAPABILITIES}};
  const attacker=plain(input.attacker)?input.attacker:null, weapon=plain(input.weapon)?input.weapon:null, target=plain(input.target)?input.target:null;
  const owned=attacker?.owner===true, visibleAttacker=attacker?.visible===true, visibleTarget=target?.visible===true;
  if(!string(attacker?.id)) add('noAttacker','attacker.id');
  if(!owned) add('noOwner','attacker.owner');
  if(!visibleAttacker) add('hiddenAttacker','attacker.visible');
  const kind=owned&&string(weapon?.id) ? weapon.kind : null;
  const supported=Boolean(kind && Object.hasOwn(RANGE_DVS,kind) && weapon.ranged===true);
  const profileVerified=owned&&weapon?.profileVerified===true;
  if(!string(weapon?.id)) add('noWeapon','weapon.id');
  else if(!supported) add('unsupportedWeapon','weapon.kind');
  if(supported&&!profileVerified) add('unknownWeaponProfile','weapon.profileVerified');
  if(supported && !integer(weapon.rof,1,2)) add('unknownROF','weapon.rof');
  if(supported) {
    const mag=plain(weapon.magazine)?weapon.magazine:null;
    if(!integer(mag?.value,0,100000)||!integer(mag?.max,1,100000)) add('unknownAmmo','weapon.magazine');
    else if(mag.value>mag.max) add('invalidMagazine','weapon.magazine');
    else if(mag.value===0) add('emptyMagazine','weapon.magazine.value');
  }
  if(!string(target?.id)) add('noTarget','target.id');
  if(!visibleTarget) add('hiddenTarget','target.visible');
  const cover=visibleTarget ? target.cover : 'unknown';
  if(cover==='blocked') add('coverBlocked','target.cover');
  else if(cover!=='clear') add('coverUnknown','target.cover');
  const sourceDistance=plain(input.distance)?input.distance:null;
  const distanceValue=typeof sourceDistance?.value==='number'&&Number.isFinite(sourceDistance.value)&&sourceDistance.value>=0&&sourceDistance.value<=100000 ? sourceDistance.value : null;
  const unit=['m','yd'].includes(sourceDistance?.unit)?sourceDistance.unit:null;
  const source=['manual','native','demo'].includes(sourceDistance?.source)?sourceDistance.source:null;
  const measurementVerified=sourceDistance?.measurementVerified===true;
  const distance={value:distanceValue,unit,source,measurementVerified};
  if(distanceValue===null || !unit) add('invalidDistance','distance');
  if(!measurementVerified || !source) add('unknownDistance','distance.measurementVerified');
  if(distanceValue!==null && !Number.isInteger(distanceValue)) add('fractionalDistance','distance.value');
  const band=distanceValue!==null && Number.isInteger(distanceValue) ? RANGE_BANDS.findIndex(([lo,hi])=>distanceValue>=lo&&distanceValue<=hi) : -1;
  const rangeDV=supported&&band>=0&&measurementVerified&&unit&&source ? RANGE_DVS[kind][band] : null;
  if(rangeDV===null) add('unknownDV','dv');
  const mode=input.mode??'single';
  if(mode!=='single') add('unsupportedMode','mode');
  const entries=[],ids=new Set();let invalidMods=false;
  if(!Array.isArray(input.modifiers)||input.modifiers.length>32) invalidMods=true;
  else for(const mod of input.modifiers) {
    if(!plain(mod)||!string(mod.id,64)||ids.has(mod.id)||!string(mod.label,256)||!string(mod.source,512)
      || typeof mod.checked!=='boolean' || (mod.enabled!==undefined&&typeof mod.enabled!=='boolean')
      || (mod.value!==null&&!integer(mod.value,-99,99))) {invalidMods=true;continue;}
    ids.add(mod.id);
    entries.push({id:mod.id,label:mod.label,source:mod.source,value:mod.value,checked:mod.checked,enabled:mod.enabled!==false,
      status:mod.enabled===false?'excluded':mod.checked&&mod.value!==null?'checked':'unknown'});
  }
  if(invalidMods) add('invalidModifiers','modifiers');
  const complete=!invalidMods&&input.modifiersComplete===true&&entries.every(e=>!e.enabled||(e.checked&&e.value!==null));
  if(!complete) add('uncheckedModifiers','modifiers');
  const sum=complete?entries.reduce((n,e)=>n+(e.enabled?e.value:0),0):null;
  const total=sum!==null&&Math.abs(sum)<=999?sum:null;
  if(sum!==null&&total===null) add('invalidModifierTotal','modifiers.total');
  const defense=visibleTarget ? defenseModel(target) : defenseModel(null);
  const conditional=defense.eligibility!=='ineligible';
  return {schemaVersion:1,adapterVersion:ATTACK_PLAN_VERSION,status:reasons.length?'blocked':'ready',reasons,
    attackerId:owned&&visibleAttacker?string(attacker?.id):null,weaponId:owned?string(weapon?.id):null,targetId:visibleTarget?string(target?.id):null,
    mode:typeof mode==='string'?mode:null,distance,
    dv:{value:rangeDV,source:rangeDV===null?'unknown':'range-table',table:supported?kind:null,
      bandLabel:band>=0?`${RANGE_BANDS[band][0]}–${RANGE_BANDS[band][1]} ${unit??''}`:null,
      sourceUrl:CPR_RULE_SOURCES.range,conditional,comparison:'attack > DV; tie defends'},
    allowedModes:modeModels(supported),costs:supported?{ammo:profileVerified?1:null,profileVerified,
      source:profileVerified?'caller-confirmed ordinary single-bullet profile':'unknown',consumeNow:false,attackChecks:1,weaponROF:integer(weapon.rof,1,2)?weapon.rof:null,
      action:'Attack Action',actionBudgetTracked:false,remainingAttackChecks:null}:null,
    defense,modifiers:{entries:owned?entries:[],total:owned?total:null,complete:owned&&complete,
      formulaCertified:false,reviewScope:'Only explicitly checked entries; native skill/stat/quality/wound/role/active effects require the system adapter.'},
    capabilities:{...CAPABILITIES}};
}
