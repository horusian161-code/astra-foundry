import {Scope} from './lifecycle.mjs';

/** Separate v12 ApplicationV2 extension points. No V1 jQuery lifecycle emulation.
 * Renderer and binder are trusted module code, not user-supplied HTML/scripts.
 */
export function createV2PanelClass({ApplicationV2, context=async()=>({}), render, bind=()=>{}, defaults={}}={}) {
  if(typeof ApplicationV2!=='function'||typeof context!=='function'||typeof render!=='function'||typeof bind!=='function') throw new TypeError('ApplicationV2 port requires a base and trusted callbacks');
  return class AstraV2Panel extends ApplicationV2 {
    static DEFAULT_OPTIONS={id:'astra-v2-panel',classes:['astra-panel-host'],window:{title:'Astra'},position:{width:480,height:'auto'},...defaults};
    #domScope=null;
    async _prepareContext(options) {return context({application:this,options});}
    async _renderHTML(data,options) {
      const html=await render(data,{application:this,options});
      if(typeof html!=='string')throw new TypeError('Trusted renderer must return HTML text');
      return html;
    }
    _replaceHTML(html,content,options) {
      if(typeof html!=='string'||!content||typeof content.addEventListener!=='function')throw new TypeError('ApplicationV2 content must be an HTMLElement');
      this.#domScope?.dispose();this.#domScope=null;
      const scope=new Scope();
      try {
        content.innerHTML=html;
        const cleanup=bind({root:content,scope,application:this,options});
        if(cleanup&&typeof cleanup.then==='function'){
          // Illegal async binders can already have rejected. Observe that result
          // before rejecting the callback contract to avoid unhandledRejection.
          void Promise.resolve(cleanup).catch(()=>{});
          throw new TypeError('DOM binder must be synchronous and register async work cleanup in its scope');
        }
        if(cleanup!==undefined&&typeof cleanup!=='function')throw new TypeError('DOM binder cleanup must be a function');
        if(cleanup)scope.track(cleanup);
        this.#domScope=scope;
      }catch(error){scope.dispose();throw error;}
    }
    async close(options={}) {
      // Base V2 queues close behind pending renders. Release both before and
      // after it: an earlier render may bind a new scope while close awaits.
      this.#domScope?.dispose();this.#domScope=null;
      try{return await super.close(options);}
      finally{this.#domScope?.dispose();this.#domScope=null;}
    }
  };
}
