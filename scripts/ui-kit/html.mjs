/** Small original rendering boundary. No DOM, Foundry, CPR or game-operation imports. */
const contentBrand=Symbol('AstraRenderedContent');
export const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Developer-owned renderer only. This is an explicit trust boundary, NOT a sanitizer. */
export function renderedContent(renderer,...args){
  if(typeof renderer!=='function')throw new TypeError('Rendered content requires an explicit trusted renderer function.');
  const html=renderer(...args);
  if(typeof html!=='string')throw new TypeError('Trusted renderer must return a string.');
  return Object.freeze({[contentBrand]:html});
}
export const isRenderedContent=value=>!!value&&typeof value==='object'&&Object.hasOwn(value,contentBrand);
const content=value=>{if(!isRenderedContent(value))throw new TypeError('Panel bodies must come from renderedContent(renderer); raw HTML strings are rejected.');return value[contentBrand];};
const classes=value=>{const result=String(value??'').trim();if(result&&!/^[A-Za-z0-9_ -]+$/.test(result))throw new TypeError('Invalid component class tokens.');return result;};
function attributes(values={}){
  return Object.entries(values).map(([key,value])=>{
    if(!/^(?:id|role|tabindex|title|aria-[a-z-]+|data-[a-z0-9-]+)$/.test(key))throw new TypeError(`Unsafe component attribute: ${key}`);
    if(value===null||value===undefined||value===false)return '';
    return ` ${key}="${escapeText(value===true?'true':value)}"`;
  }).join('');
}
export function renderAction({label='',action,actionAttribute='data-astra-action',className='',disabled=false,busy=false,title,ariaLabel,body=null,attrs={}}={}){
  if(!/^data-[a-z][a-z0-9-]*$/.test(actionAttribute))throw new TypeError('Action attribute must be a data attribute.');
  if(action===null||action===undefined||String(action).length>128)throw new TypeError('Action identifier is required and bounded.');
  return `<button type="button" class="astra-action ${classes(className)}" ${actionAttribute}="${escapeText(action)}"${disabled?' disabled':''}${busy?' aria-busy="true"':''}${attributes({...attrs,title,'aria-label':ariaLabel})}>${body===null?escapeText(label):content(body)}</button>`;
}
export function renderPanelHeading({title,subtitle=null,icon=null,level=2,titleId=null,classes:tokens={},actions=[]}={}){
  if(![1,2,3,4,5,6].includes(level))throw new TypeError('Heading level must be 1–6.');
  return `<div class="astra-heading ${classes(tokens.heading)}" data-astra-heading>${icon===null?'':`<div class="astra-heading__icon ${classes(tokens.icon)}" aria-hidden="true">${escapeText(icon)}</div>`}<div class="astra-heading__titles ${classes(tokens.titles)}">${subtitle===null?'':`<small>${escapeText(subtitle)}</small>`}<h${level}${titleId?attributes({id:titleId}):''}>${escapeText(title)}</h${level}></div>${actions.map(renderAction).join('')}</div>`;
}
export function renderPanelShell({title,subtitle=null,icon=null,body,classes:tokens={},attrs={},actions=[],level=2,managedMotion=false}={}){
  const panelClasses=`astra-panel ${classes(tokens.panel)}`;
  // Header children preserve host selectors while the heading primitive stays reusable.
  const heading=renderPanelHeading({title,subtitle,icon,level,classes:tokens,actions});
  return `<aside class="${panelClasses}" data-astra-panel${managedMotion?' data-astra-motion-managed="true"':''}${attributes({'aria-label':title,tabindex:-1,...attrs})}><header>${heading}</header><div class="astra-panel__body ${classes(tokens.body)}">${content(body)}</div></aside>`;
}
