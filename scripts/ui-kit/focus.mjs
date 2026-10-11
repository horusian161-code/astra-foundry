/** Focus bookmarks contain stable attributes and caret positions, never DOM references. */
const defaults=['id','data-astra-focus-key','data-astra-action'];
const attributeName=value=>typeof value==='string'&&/^(?:id|data-[a-z0-9-]+)$/.test(value);
const selectorValue=value=>String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/[\u0000-\u001f\u007f]/g,c=>`\\${c.charCodeAt(0).toString(16)} `);
export function captureFocus(root,{document=root?.ownerDocument || root,attributes=defaults}={}){
  const active=document?.activeElement;
  if(!active||!root?.contains?.(active)||active.isConnected===false)return null;
  for(const attribute of attributes){
    if(!attributeName(attribute))throw new TypeError('Focus keys must be id or data attributes.');
    const value=active.getAttribute?.(attribute);
    if(typeof value!=='string'||!value||value.length>512)continue;
    const bookmark={attribute,value};
    if(Number.isSafeInteger(active.selectionStart)&&Number.isSafeInteger(active.selectionEnd))bookmark.selection={start:active.selectionStart,end:active.selectionEnd};
    return Object.freeze(bookmark);
  }
  return null;
}
function usable(root,element){
  return !!element&&element.isConnected!==false&&root.contains?.(element)&&typeof element.focus==='function'&&!element.disabled&&element.getAttribute?.('aria-disabled')!=='true'&&!element.closest?.('[hidden],[inert],[aria-hidden="true"]');
}
export function restoreFocus(root,bookmark,{fallbackSelectors=[]}={}){
  if(!root?.querySelector||!root?.contains)return false;
  const candidates=[];
  if(bookmark){
    if(!attributeName(bookmark.attribute)||typeof bookmark.value!=='string'||bookmark.value.length>512)return false;
    candidates.push({selector:`[${bookmark.attribute}="${selectorValue(bookmark.value)}"]`,isBookmark:true});
  }
  if(!Array.isArray(fallbackSelectors))throw new TypeError('Fallback selectors must be an array.');
  candidates.push(...fallbackSelectors.map(selector=>({selector,isBookmark:false})));
  for(const {selector,isBookmark} of candidates){
    let element;try{element=root.querySelector(selector);}catch{continue;}
    if(!usable(root,element))continue;
    element.focus({preventScroll:true});
    if(isBookmark&&bookmark?.selection&&typeof element.setSelectionRange==='function'){
      try{element.setSelectionRange(bookmark.selection.start,bookmark.selection.end);}catch{}
    }
    return true;
  }
  return false;
}
