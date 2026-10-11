/** Explicit demo-only GM override. Draft fields never change the prepared plan. */
export function commitDemoManualOverride({value,source},principal) {
  if(principal?.role!=='gm')throw new Error('Ручной DV доступен только GM.');
  if(!Number.isSafeInteger(value)||value<1||value>99||typeof source!=='string'||!source.trim()||source.length>160)throw new Error('Нужны целый DV от 1 до 99 и обоснование.');
  return {value,source:source.trim()};
}
export function applyDemoManualOverride(plan,committedOverride) {
  if(!committedOverride||!Number.isSafeInteger(committedOverride.value)||committedOverride.value<1||committedOverride.value>99||typeof committedOverride.source!=='string'||!committedOverride.source.trim()||committedOverride.source.length>160)return plan;
  const reasons=plan.reasons.filter(r=>r.code!=='unknownDV');
  return {...plan,reasons,status:reasons.length?'blocked':'ready',dv:{...plan.dv,value:committedOverride.value,source:'manual-demo-gm',table:null,bandLabel:committedOverride.source,conditional:true}};
}
