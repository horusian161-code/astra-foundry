/** Deterministic examples are produced only in execute, after defense choice. */
export function createDemoAttackDescriptor({ledger}) {
  const argumentKeys=new Set(['namespace','attackerId','attackerName','targetId','targetName','weaponId','weaponName','ammoKey','rangeDV','dvSource']);
  const command=(args,decision)=>{
    if(!['evade','accept'].includes(decision?.choice))throw new Error('Выбор защиты ещё не получен.');
    // Evasion precedes the attack sample. No sample exists during preparation.
    const evasion=decision.choice==='evade'?17:null;
    const ammoKey=args.ammoKey || `${args.attackerId}:${args.weaponId}`;
    return {attackTotal:19,damage:18,ammoKey,dv:evasion??args.rangeDV,dvSource:evasion!==null?'Демоуклонение · 17':'DV по дальности · '+args.rangeDV,
      identity:JSON.stringify(['demo.redline.attack',args.namespace,args.attackerId,args.attackerName,args.targetId,args.targetName,args.weaponId,args.weaponName,ammoKey,args.rangeDV,args.dvSource,decision.choice])};
  };
  return {
    id:'demo.redline.attack',version:1,idempotent:false,
    validate:args=>args!==null&&typeof args==='object'&&Object.keys(args).every(key=>argumentKeys.has(key))&&typeof args?.namespace==='string'&&typeof args?.attackerId==='string'&&typeof args?.attackerName==='string'&&typeof args?.targetId==='string'&&typeof args?.targetName==='string'&&typeof args?.weaponId==='string'&&typeof args?.weaponName==='string'&&(args.ammoKey===undefined||args.ammoKey===`${args.attackerId}:${args.weaponId}`)&&typeof args?.dvSource==='string'&&Number.isSafeInteger(args?.rangeDV)&&args.rangeDV>0&&args.rangeDV<=99,
    permission:(args,{principal,stage})=>stage==='inspect-private'?principal?.role==='gm':principal?.id==='demo-user'&&['player','gm'].includes(principal?.role),
    preview:async args=>({public:{attackerId:args.attackerId,attackerName:args.attackerName,targetId:args.targetId,targetName:args.targetName,weaponId:args.weaponId,weaponName:args.weaponName,ammoKey:args.ammoKey || `${args.attackerId}:${args.weaponId}`,rangeDV:args.rangeDV,dvSource:args.dvSource,ammoCost:1,consumeNow:false,defenseEligibility:'eligible',demo:true}}),
    argsSchema:{type:'object',additionalProperties:false,required:['namespace','attackerId','attackerName','targetId','targetName','weaponId','weaponName','rangeDV','dvSource'],properties:{namespace:{type:'string'},attackerId:{type:'string'},attackerName:{type:'string'},targetId:{type:'string'},targetName:{type:'string'},weaponId:{type:'string'},weaponName:{type:'string'},ammoKey:{type:'string'},rangeDV:{type:'integer',minimum:1,maximum:99},dvSource:{type:'string'}}},
    resultSchema:{type:'object',required:['hit','attackTotal','dv','ammoSpent','ammoKey'],properties:{hit:{type:'boolean'},attackTotal:{type:'integer'},dv:{type:'integer'},damage:{type:'integer'},ammoSpent:{const:1},ammoKey:{type:'string'},targetResourceChanged:{type:'boolean'}}},
    permissionDescription:'One isolated browser fixture user, no Foundry rights or game mutations.',mutates:['isolated demo IndexedDB resources','atomic receipt ledger'],compensation:null,
    decision:{options:['evade','accept'],timeoutMs:300000},
    execute:async(args,{decision,requestId,assertFence})=>{
      const payload=command(args,decision);
      await assertFence();
      return ledger.applyOnce(args.namespace,requestId,payload);
    },
    reconcile:async(args,{requestId,record})=>record?.decision?.choice?ledger.verifiedReceipt(args.namespace,requestId,command(args,record.decision)):null
  };
}
