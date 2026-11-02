/* ChatGPT 입력창/전송 버튼 공통 어댑터. 화면 변형은 접근성 속성과 폼 범위로 식별한다. */
(function (root) {
  'use strict';
  const EDITOR_SELECTORS = [
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    '[data-testid="prompt-textarea"]',
    'textarea#mobile-composer-prompt',
    'form[data-chatgpt-composer] [contenteditable="true"]',
    'form[data-chatgpt-composer] .ProseMirror[role="textbox"]',
    '.ProseMirror[role="textbox"]',
    '.ProseMirror[contenteditable="true"]',
    '[data-composer-markdown][role="textbox"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    '[role="textbox"][contenteditable="true"]'
  ];
  const SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid*="send-button"]',
    '#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button[aria-label="프롬프트 보내기"]',
    'button[aria-label="메시지 보내기"]',
    'button[aria-label="전송"]',
    'button.composer-submit-btn'
  ];
  function visible(node) {
    return !!node && typeof node.getClientRects === 'function' && node.getClientRects().length > 0;
  }
  function firstVisible(rootNode, selectors) {
    for (const selector of selectors) {
      const el=rootNode?.querySelector?.(selector);
      if (visible(el)) return el;
    }
    return null;
  }
  function findEditor(doc) {
    const el=firstVisible(doc,EDITOR_SELECTORS);
    if (el?.getAttribute?.('contenteditable') === 'false') return null;
    return el;
  }
  function findSend(doc, el) {
    const form=el?.closest?.('form') || doc?.querySelector?.('form[data-chatgpt-composer]') || null;
    // send-button 식별자는 안전하게 사용하되, type=submit은 반드시 해당 폼 안으로 한정한다.
    const fromForm=firstVisible(form,SEND_SELECTORS);
    if(fromForm) return fromForm;
    const global=firstVisible(doc,SEND_SELECTORS);
    if(global) return global;
    if(form && (!form.contains || form.contains(el))) {
      return firstVisible(form,['button[type="submit"]']);
    }
    return null;
  }
  function enabled(button) {
    return !!button && visible(button) && !button.disabled &&
      button.getAttribute?.('aria-disabled') !== 'true' &&
      button.getAttribute?.('data-state') !== 'disabled';
  }
  function isTextarea(el) {
    if (!el) return false;
    if (typeof HTMLTextAreaElement!=='undefined' && el instanceof HTMLTextAreaElement) return true;
    if (typeof HTMLInputElement!=='undefined' && el instanceof HTMLInputElement) return true;
    return /^(TEXTAREA|INPUT)$/.test(el.tagName || '');
  }
  function fill(el,message,doc=typeof document!=='undefined' ? document:null) {
    if(!el)throw Error('입력창이 없습니다.');
    el.focus();
    if(isTextarea(el)){
      const proto=typeof HTMLTextAreaElement!=='undefined' && el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
        typeof HTMLInputElement!=='undefined' && el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
      const setter=proto && Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(el,message);
      else el.value=message;
    }else{
      const selection=typeof window!=='undefined' ? window.getSelection?.():null;
      const range=doc?.createRange?.();
      if(range?.selectNodeContents){
        range.selectNodeContents(el);
        selection?.removeAllRanges?.();
        selection?.addRange?.(range);
      }
      try{doc?.execCommand?.('delete',false,null);}catch{}
      let inserted=false;
      try{inserted=doc?.execCommand?.('insertText',false,message)===true;}catch{}
      if(!inserted || !(el.textContent || '').trim()){
        el.textContent=message;
      }
    }
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:message}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  // rich-text 에디터는 줄바꿈을 <p>로 재구성할 수 있으므로 공백 차이만 허용한다.
  // 프롬프트가 전부 유지되었는지 확인하지 못하면 절대로 전송하지 않는다.
  const condensed=(value)=>String(value||'').replace(/[\s\u200b-\u200d\ufeff]/g,'');
  function containsPrompt(el,prompt) {
    if(!el || typeof prompt!=='string'||!prompt.length)return false;
    const expected=condensed(prompt);
    if(!expected.length)return false;
    const candidates=[el.value,el.innerText,el.textContent];
    return candidates.some(x=>typeof x==='string' && condensed(x).includes(expected));
  }
  function diagnosis(doc) {
    const found=findEditor(doc);
    const send=findSend(doc,found);
    const editors=EDITOR_SELECTORS.reduce((n,q)=>n+(visible(doc?.querySelector?.(q))?1:0),0);
    return {
      editorFound:!!found, sendFound:!!send, sendEnabled:enabled(send),
      editorSelectorMatches:editors,
      editorKind:found ? (isTextarea(found)?'textarea':'rich-text') : 'none'
    };
  }
  const api={findEditor,findSend,enabled,fill,containsPrompt,diagnosis};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(root)root.AutoPilotComposer=api;
})(typeof window!=='undefined'?window:null);
