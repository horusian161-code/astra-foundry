/** Local fixture initiative only. Native Foundry Combat is never changed. */
const requestId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
export function createDemoTurnState(value={}) {
  if(value===null||typeof value!=='object'||Array.isArray(value))value={};
  return {
    round:Number.isSafeInteger(value.round)&&value.round>=1&&value.round<=1000000?value.round:3,
    turn:Number.isSafeInteger(value.turn)&&value.turn>=0&&value.turn<1000?value.turn:1,
    advancedRequestIds:Array.isArray(value.advancedRequestIds)&&value.advancedRequestIds.length<=2048&&value.advancedRequestIds.every(requestId)?[...new Set(value.advancedRequestIds)]:[]
  };
}
export function projectDemoInitiative(queue,state) {
  if(!Array.isArray(queue)||!queue.length)return [];
  const current=Math.min(Math.max(0,state.turn),queue.length-1),next=(current+1)%queue.length;
  return queue.map((row,index)=>({...row,current:index===current,next:index===next}));
}
export function advanceDemoTurn(state,queue,operation) {
  if(!Array.isArray(queue)||queue.length===0)throw new Error('Нет участников демобоя. Ход не изменён.');
  if(operation?.operation!=='demo.redline.attack'||operation?.state!=='resolved'||operation?.receipt?.applied!==true||operation?.result===null||typeof operation?.result!=='object'||!requestId(operation?.id)||operation.receipt.requestId!==operation.id)throw new Error('Следующий демоход требует завершённой атаки и подтверждённой квитанции.');
  if(state.advancedRequestIds.includes(operation.id))throw new Error('Этот завершённый запрос уже продвинул демоход.');
  if(state.advancedRequestIds.length>=2048)throw new Error('Лимит истории демоходов достигнут. Создайте новый демосценарий.');
  const current=Math.min(Math.max(0,state.turn),queue.length-1),turn=(current+1)%queue.length;
  return {...state,turn,round:state.round+(turn===0?1:0),advancedRequestIds:[...state.advancedRequestIds,operation.id]};
}
