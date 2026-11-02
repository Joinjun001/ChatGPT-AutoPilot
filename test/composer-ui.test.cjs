'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const SOURCE=fs.readFileSync(require.resolve('../src/composer-ui.js'),'utf8');
function setup(disabled=false){
  let clicked=0;
  const button={disabled,getClientRects(){return [1]},getAttribute(){return null},click(){clicked++;}};
  const form={contains(node){return node===editor},querySelector(q){return q==='button[type="submit"]'?button:null}};
  const editor={
    tagName:'DIV',textContent:'',getClientRects(){return [1]},
    getAttribute(q){return q==='contenteditable'?'true':null},
    closest(q){return q==='form'?form:null},
    focus(){},dispatchEvent(e){if(e.type==='input'&&!disabled)button.disabled=false;}
  };
  const doc={
    querySelector(q){
      if(q==='.ProseMirror[role="textbox"]')return editor;
      if(q==='form[data-chatgpt-composer]')return form;
      return null;
    },
    createRange(){return {selectNodeContents(){}}},
    execCommand(q,_unused,arg){
      if(q==='delete'){editor.textContent='';return true;}
      if(q==='insertText'){editor.textContent=arg;return true;}
      return false;
    }
  };
  const ctx={
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    InputEvent:class{constructor(type){this.type=type;}},
    Event:class{constructor(type){this.type=type;}},document:doc
  };
  vm.runInNewContext(SOURCE,ctx);
  return {C:ctx.window.AutoPilotComposer,doc,editor,form,button,get clicked(){return clicked}};
}
test('ProseMirror role textbox and form submit button supported',()=>{
  const x=setup();
  assert.equal(x.C.findEditor(x.doc),x.editor);
  const message='first line\nsecond line';
  x.C.fill(x.editor,message,x.doc);
  assert.equal(x.C.containsPrompt(x.editor,message),true);
  assert.equal(x.C.findSend(x.doc,x.editor),x.button);
  assert.equal(x.C.enabled(x.button),true);
  x.button.click();
  assert.equal(x.clicked,1);
});
test('Partial text is not considered valid prompt',()=>{
  const x=setup();
  x.editor.textContent='firstlast';
  assert.equal(x.C.containsPrompt(x.editor,'first middle last'),false);
  x.editor.textContent='firstmiddlelast';
  assert.equal(x.C.containsPrompt(x.editor,'first middle last'),true);
});
test('Disabled send never enabled by fallback',()=>{
  const x=setup(true);
  x.C.fill(x.editor,'abc',x.doc);
  assert.equal(x.C.enabled(x.button),false);
});
