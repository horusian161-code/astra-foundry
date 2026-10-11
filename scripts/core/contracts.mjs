/** Alpha API descriptors: current read projection and pure preparation; no game execution. */
export const API_VERSION = '0.3.0-alpha.1';
export const OPERATION_CATALOG = Object.freeze([
  {id:'read.snapshot',version:1,args:{type:'object',additionalProperties:false},result:{type:'object',required:['queue','selected','targets','capabilities']},mutates:[],permission:'current-user OWNER/GM resource projection; Canvas-visible identities',preview:{pure:true},cleanup:null},
  {id:'attack.preview',version:1,args:{type:'object',properties:{weaponId:{type:'string',maxLength:256},targetUuid:{type:'string',maxLength:256},distance:{type:['string','number']},distanceConfirmed:{type:'boolean'},cover:{enum:['unknown','clear','blocked']},modifier:{type:['string','number']},modifiersReviewed:{type:'boolean'},profileReviewed:{type:'boolean'}},additionalProperties:false},result:{type:'object',required:['plan','draft']},mutates:[],permission:'current owned Token.actor and current visible targets; accepts no permission assertions',preview:{pure:true},cleanup:null},
  {id:'read.queue',version:1,args:{type:'object',additionalProperties:false},result:{type:'array'},mutates:[],permission:'visible Combatants; hidden entries GM only',preview:{pure:true},cleanup:null},
  {id:'read.selection',version:1,args:{type:'object',additionalProperties:false},result:{type:['object','null']},mutates:[],permission:'owned and visible controlled Token.actor',preview:{pure:true},cleanup:null},
  {id:'read.targets',version:1,args:{type:'object',additionalProperties:false},result:{type:'array'},mutates:[],permission:'current-user visible target tokens; exact resources OWNER/GM only',preview:{pure:true},cleanup:null},
  {id:'ui.open',version:1,args:{type:'object',additionalProperties:false},result:{type:'boolean'},mutates:['current-client DOM'],permission:'current client',preview:null,cleanup:'ui.close'},
  {id:'ui.close',version:1,args:{type:'object',additionalProperties:false},result:{type:'boolean'},mutates:['current-client DOM'],permission:'current client',preview:null,cleanup:'DOM listeners, pending refresh timers'},
  {id:'ui.toggle',version:1,args:{type:'object',additionalProperties:false},result:{type:'boolean'},mutates:['current-client DOM'],permission:'current client',preview:null,cleanup:'ui.close'}
]);
export const CAPABILITIES = Object.freeze({readOnly:true,nativeRoll:false,attackPrepare:true,damageApply:false,ammoChange:false,nextTurn:false,netAutomation:false,worldSettings:false,distributedExecution:false});
export const DEFAULT_PREFS=Object.freeze({compact:false,collapsed:false,scale:1,dock:'right',reduced:false});
export const normalizePreferences=value=>({compact:value?.compact===true,collapsed:value?.collapsed===true,scale:[1,1.15,1.3].includes(value?.scale)?value.scale:1,dock:value?.dock==='left'?'left':'right',reduced:value?.reduced===true});
