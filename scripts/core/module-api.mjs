import * as kernel from '../sdk/index.mjs';
import {Scope,RefreshScheduler} from './lifecycle.mjs';
import {createV2PanelClass} from './application-v2-port.mjs';
import {API_VERSION,OPERATION_CATALOG,CAPABILITIES} from './contracts.mjs';
import {invokeNativeOperation} from '../adapters/native-api-port.mjs';

/** Developer SDK is trusted setup code, not a network/authentication boundary.
 * Service calls derive identity anew from the configured current-user provider.
 */
export function createModuleAPI({controller,getCurrentUser,components={},nativePort=null}={}) {
  if(!controller||typeof getCurrentUser!=='function')throw new TypeError('Module API requires controller and current-user provider');
  const createService=({engine}={})=>new kernel.OperationService({engine,resolvePrincipal:async()=>{
    const user=await getCurrentUser();
    if(!user||typeof user.id!=='string'||!user.id||user.id.length>128)throw new kernel.OperationError('rights','Current Foundry user unavailable');
    return {id:user.id,role:user.isGM===true?'gm':'player'};
  }});
  const sdk=Object.freeze({...kernel,Scope,RefreshScheduler,createV2PanelClass,createService,
    version:API_VERSION,securityBoundary:'trusted module setup; no server transport or remote authentication'});
  const api={version:API_VERSION,capabilities:CAPABILITIES,sdk,components:Object.freeze({...components}),
    catalog:()=>structuredClone(OPERATION_CATALOG),invoke:(id,args)=>invokeNativeOperation(controller,id,args),
    snapshot:()=>controller.snapshot(),queue:()=>controller.snapshot().queue,selection:()=>controller.snapshot().selected,
    targets:()=>controller.snapshot().targets,prepareAttack:args=>invokeNativeOperation(controller,'attack.preview',args),
    open:()=>controller.open(),close:()=>controller.close(),toggle:()=>controller.toggle()};
  if(nativePort)api.native=Object.freeze({prepare:args=>nativePort.prepare(args),execute:args=>nativePort.execute(args),openFallback:args=>nativePort.openFallback(args)});
  return Object.freeze(api);
}
