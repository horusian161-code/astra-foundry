import {Scope} from '../core/lifecycle.mjs';
import {renderHUD} from './render.mjs';
import {captureFocus,restoreFocus,MotionCoordinator} from '../ui-kit/index.mjs';
const previousPanels=new WeakMap();

/** Foundry v12 V1 port. Not an ApplicationV2 lifecycle emulation. */
export class REDLINEApplication extends Application {
  constructor(controller) { super(); this.controller=controller; this.domScope=null; this.motion=new MotionCoordinator(); }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions,{id:'astra-redline-combat-hud',template:'modules/astra-redline-combat/templates/hud.hbs',popOut:false,resizable:false});
  }
  getData() { return {}; }
  activateListeners(html) {
    super.activateListeners(html);
    this.domScope?.dispose();this.domScope=new Scope();
    this.motion.dispose();this.motion=new MotionCoordinator();
    this.domScope.track(()=>this.motion.dispose());
    const root=html[0]?.matches?.('[data-redline-root]') ? html[0] : html[0]?.querySelector?.('[data-redline-root]');
    if(!root) return;
    this.controller.renderInto(root);
    this.domScope.listen(root,'click',event=>{void this.controller.onClick(event).catch(error=>this.controller.fail(error));});
    this.domScope.listen(root,'change',event=>{void this.controller.onChange(event).catch(error=>this.controller.fail(error));});
    this.domScope.listen(root,'input',event=>{void this.controller.onInput(event).catch(error=>this.controller.fail(error));});
  }
  async close(options={}) {
    this.domScope?.dispose();this.domScope=null;
    this.motion.dispose();
    this.controller.stop();
    this.controller.panel=null;
    return super.close(options);
  }
  refresh() {
    const outer=this.element?.[0], root=outer?.matches?.('[data-redline-root]') ? outer : outer?.querySelector?.('[data-redline-root]');
    if(root) this.controller.renderInto(root); else this.render(true);
  }
}
export function updateLayout(root) {
  const sidebar=document.querySelector('#sidebar');
  const rect=sidebar?.getBoundingClientRect();
  const visible=rect && getComputedStyle(sidebar).display!=='none' && rect.width>0;
  const right=visible ? Math.max(18,window.innerWidth-rect.left+12) : 18;
  root.style.setProperty('--rl-right',`${right}px`);
  root.style.setProperty('--rl-left',window.innerWidth<=1050?'65px':'80px');
  const character=root.querySelector('.rl-character');
  if(character) root.style.setProperty('--rl-panel-bottom',`${Math.max(180,window.innerHeight-character.getBoundingClientRect().top+12)}px`);
}
export function updateHUD(root, model, prefs, state, motion=null) {
  const bookmark=captureFocus(root,{document,attributes:['id','data-rl-attack-field','data-rl-action','data-rl-weapon']});
  const panelChanged=previousPanels.get(root)!==state?.panel;
  motion?.cancelAll('DOM-replaced');
  const queueScroll=root.querySelector('.rl-queue')?.scrollLeft ?? 0;
  const panelScroll=root.querySelector('.rl-panel-body')?.scrollTop ?? 0;
  root.innerHTML=renderHUD(model,prefs,state);
  const queue=root.querySelector('.rl-queue'),panel=root.querySelector('.rl-panel-body');
  if(queue) queue.scrollLeft=queueScroll;
  if(panel) panel.scrollTop=panelScroll;
  updateLayout(root);
  restoreFocus(root,bookmark);
  if(panelChanged&&state?.panel&&panel)void motion?.play(panel,[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:140},{reduced:prefs.reduced||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true});
  previousPanels.set(root,state?.panel??null);
}
