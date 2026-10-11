/** Presentation only. Completion and cancellation never execute game operations. */
export class MotionCoordinator {
  #active=new Map();#disposed=false;
  get activeCount(){return this.#active.size;}
  play(element,keyframes,options={},{signal=null,reduced=false}={}){
    this.cancel(element,'reinvoked');
    if(this.#disposed)return Promise.resolve({state:'skipped',reason:'disposed'});
    if(signal?.aborted)return Promise.resolve({state:'cancelled',reason:'aborted'});
    if(reduced)return Promise.resolve({state:'skipped',reason:'reduced-motion'});
    if(!element||element.isConnected===false||typeof element.animate!=='function')return Promise.resolve({state:'skipped',reason:'unavailable'});
    let animation;try{animation=element.animate(keyframes,{duration:160,easing:'ease-out',fill:'none',...options});}catch{return Promise.resolve({state:'skipped',reason:'unavailable'});}
    if(!animation||typeof animation.cancel!=='function'||typeof animation.finished?.then!=='function'){try{animation?.cancel?.();}catch{}return Promise.resolve({state:'skipped',reason:'unavailable'});}
    return new Promise(resolve=>{
      let settled=false;
      const finish=(state,reason=null)=>{
        if(settled)return;settled=true;
        signal?.removeEventListener?.('abort',abort);
        if(this.#active.get(element)===entry)this.#active.delete(element);
        try{animation.cancel?.();}catch{}
        resolve({state,...(reason?{reason}:{})});
      };
      const abort=()=>finish('cancelled','aborted');
      const entry={cancel:reason=>finish('cancelled',reason)};
      this.#active.set(element,entry);
      signal?.addEventListener?.('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      Promise.resolve(animation.finished).then(()=>finish('finished'),()=>finish('cancelled','animation-cancelled'));
    });
  }
  cancel(element,reason='cancelled'){const entry=this.#active.get(element);if(!entry)return false;entry.cancel(reason);return true;}
  cancelAll(reason='cleanup'){for(const [element] of [...this.#active])this.cancel(element,reason);}
  dispose(){this.#disposed=true;this.cancelAll('disposed');}
}
