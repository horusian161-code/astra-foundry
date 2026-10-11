import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeText,renderedContent,renderAction,renderPanelHeading,renderPanelShell,captureFocus,restoreFocus,MotionCoordinator} from '../scripts/ui-kit/index.mjs';
import {renderWorkflowPanel} from '../scripts/ui/workflow-render.mjs';
import {renderPreparationPanel} from '../scripts/ui/preparation-panel.mjs';

test('panel and action labels escape untrusted data; raw and forged HTML bodies reject',()=>{
  const payload='<img src=x onerror="alert(1)">';
  const html=renderPanelShell({title:payload,subtitle:payload,body:renderedContent(text=>`<p>${escapeText(text)}</p>`,payload),actions:[{label:payload,action:'close'}]});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/data-astra-panel/);
  assert.throws(()=>renderPanelShell({title:'Example',body:payload}),/raw HTML/);
  assert.throws(()=>renderPanelShell({title:'Example',body:{html:'<p>forged</p>'}}),/raw HTML/);
  assert.throws(()=>renderedContent(payload),/renderer function/);
  assert.throws(()=>renderAction({label:'Run',action:'run',attrs:{onclick:'alert(1)'}}),/Unsafe component attribute/);
  assert.throws(()=>renderAction({label:'Run',action:'run',actionAttribute:'onclick'}),/data attribute/);
});
test('trusted rich action and reusable headings retain escaped titles and structured data actions',()=>{
  const action=renderAction({label:'Ignored',body:renderedContent(()=>'<strong>Защита</strong><span>Выбор</span>'),action:'evade',actionAttribute:'data-wf-action',disabled:true,busy:true});
  assert.match(action,/<strong>Защита<\/strong>/);assert.match(action,/data-wf-action="evade"/);assert.match(action,/disabled/);assert.match(action,/aria-busy="true"/);
  const heading=renderPanelHeading({title:'A & B',level:3});assert.match(heading,/<h3>A &amp; B<\/h3>/);assert.throws(()=>renderPanelHeading({title:'bad',level:9}),/Heading level/);
});
test('REDLINE native preparation and workflow/journal/base actually share the panel kit',()=>{
  const native=renderPreparationPanel({weaponName:'<script>bad</script>',draft:{distance:'',modifier:'',cover:'unknown'},plan:{status:'blocked',reasons:[],dv:{value:null},defense:{reason:'Нужно решение GM'}}},{targets:[],selected:null});
  assert.match(native,/astra-panel rl-panel rl-preparation/);assert.match(native,/data-rl-action="close-panel"/);assert.match(native,/&lt;script&gt;bad/);assert.doesNotMatch(native,/<script>/);
  const lab=renderWorkflowPanel({phase:'sdk-lab',reuse:{journal:{accessible:false},base:{accessible:false}}});
  assert.match(lab,/astra-panel wf-panel purple/);assert.equal((lab.match(/data-astra-heading/g)||[]).length,3);assert.match(lab,/Интерактивный журнал/);assert.match(lab,/База «Маяк»/);
});
function mockDOM(){
  const document={activeElement:null},elements=[];
  const root={ownerDocument:document,contains:node=>elements.includes(node)&&node.isConnected,querySelector:selector=>{
    if(selector==='.fallback')return elements.find(node=>node.fallback&&node.isConnected)||null;
    const match=selector.match(/^\[([a-z0-9-]+)="((?:\\.|[^"\\])*)"\]$/i);if(!match)return null;
    const value=match[2].replace(/\\([\\"])/g,'$1');return elements.find(node=>node.attrs[match[1]]===value&&node.isConnected)||null;
  }};
  const add=attrs=>{const node={attrs,isConnected:true,disabled:false,getAttribute:name=>attrs[name]??null,closest:()=>node.hidden?node:null,focus:options=>{node.options=options;document.activeElement=node;},setSelectionRange:(start,end)=>{node.selectionStart=start;node.selectionEnd=end;}};elements.push(node);return node;};
  return {document,root,add};
}
test('focus survives rerender through a stable bookmark, never the detached original element',()=>{
  const {document,root,add}=mockDOM(),old=add({'data-astra-focus-key':'distance'});old.selectionStart=2;old.selectionEnd=4;document.activeElement=old;
  const bookmark=captureFocus(root);assert.deepEqual(bookmark,{attribute:'data-astra-focus-key',value:'distance',selection:{start:2,end:4}});assert.equal(Object.values(bookmark).includes(old),false);
  old.isConnected=false;const current=add({'data-astra-focus-key':'distance'});assert.equal(restoreFocus(root,bookmark),true);assert.equal(document.activeElement,current);assert.deepEqual(current.options,{preventScroll:true});assert.equal(current.selectionStart,2);
});
test('focus rejects hidden, disabled and disconnected destinations; close can restore a live opener',()=>{
  const {document,root,add}=mockDOM(),opener=add({id:'open-panel'});document.activeElement=opener;const bookmark=captureFocus(root);opener.disabled=true;
  const fallback=add({id:'fallback'});fallback.fallback=true;assert.equal(restoreFocus(root,bookmark,{fallbackSelectors:['.fallback']}),true);assert.equal(document.activeElement,fallback);
  opener.disabled=false;opener.hidden=true;assert.equal(restoreFocus(root,bookmark),false);opener.hidden=false;assert.equal(restoreFocus(root,bookmark),true);assert.equal(document.activeElement,opener);
  opener.isConnected=false;assert.equal(restoreFocus(root,bookmark),false);assert.equal(captureFocus(root),null);
});
function mockAnimatedElement(){
  const animations=[];
  const element={isConnected:true,animate:(frames,options)=>{let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});const animation={frames,options,finished,cancelCalls:0,cancel(){animation.cancelCalls++;reject(new Error('cancelled'));},finish:resolve};animations.push(animation);return animation;}};
  return {element,animations};
}
test('motion reinvocation cancels the old animation and cleans the completed effect',async()=>{
  const {element,animations}=mockAnimatedElement(),motion=new MotionCoordinator();
  const first=motion.play(element,[{opacity:0},{opacity:1}]),second=motion.play(element,[{opacity:0},{opacity:1}],{duration:80});
  assert.deepEqual(await first,{state:'cancelled',reason:'reinvoked'});assert.equal(animations[0].cancelCalls,1);assert.equal(motion.activeCount,1);
  animations[1].finish();assert.deepEqual(await second,{state:'finished'});assert.equal(motion.activeCount,0);assert.equal(animations[1].cancelCalls,1);
});
test('motion abort and dispose cancel presentation without invoking any operation',async()=>{
  const {element,animations}=mockAnimatedElement(),motion=new MotionCoordinator(),controller=new AbortController();
  const pending=motion.play(element,[{opacity:0},{opacity:1}],{},{signal:controller.signal});controller.abort();assert.deepEqual(await pending,{state:'cancelled',reason:'aborted'});assert.equal(motion.activeCount,0);
  const next=motion.play(element,[{opacity:0},{opacity:1}]);motion.dispose();assert.deepEqual(await next,{state:'cancelled',reason:'disposed'});assert.equal(animations.length,2);assert.equal(motion.activeCount,0);
  assert.deepEqual(await motion.play(element,[]),{state:'skipped',reason:'disposed'});
});
test('reduced motion, missing WAAPI and detached nodes use immediate readable state',async()=>{
  const {element,animations}=mockAnimatedElement(),motion=new MotionCoordinator();
  assert.deepEqual(await motion.play(element,[],{},{reduced:true}),{state:'skipped',reason:'reduced-motion'});assert.equal(animations.length,0);
  element.isConnected=false;assert.deepEqual(await motion.play(element,[]),{state:'skipped',reason:'unavailable'});
  assert.deepEqual(await motion.play({isConnected:true,animate:()=>undefined},[]),{state:'skipped',reason:'unavailable'});assert.equal(motion.activeCount,0);
});
test('motion completion releases its AbortSignal subscription and never restores an old effect',async()=>{
  const {element,animations}=mockAnimatedElement(),motion=new MotionCoordinator(),listeners=new Set();
  const signal={aborted:false,addEventListener:(type,listener)=>listeners.add(listener),removeEventListener:(type,listener)=>listeners.delete(listener)};
  const pending=motion.play(element,[{opacity:0},{opacity:1}],{},{signal});assert.equal(listeners.size,1);
  animations[0].finish();assert.equal((await pending).state,'finished');assert.equal(listeners.size,0);assert.equal(motion.activeCount,0);
  assert.equal(motion.cancel(element),false);assert.equal(animations[0].cancelCalls,1);
});
