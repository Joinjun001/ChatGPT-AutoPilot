'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../src/protocol.js');

test('두 회차를 동적 프롬프트로 실행하고 DONE에서 중지 (DOM 모의 통합 검사)', {timeout:20000}, async () => {
  let transcript = '';
  let busy = false;
  let sent = [];
  let listener;
  const values = {};
  const intervals = [];
  const timeouts = [];
  const visible = {getClientRects:()=>[1], getAttribute:()=>null};
  class FakeTextarea {
    constructor() { this._value = ''; }
    get value() { return this._value; }
    set value(x) { this._value=x; }
    getClientRects() { return [1]; }
    focus() {}
    dispatchEvent() {}
  }
  const textarea = new FakeTextarea();
  const main = {get innerText() {return transcript;}, querySelectorAll:()=>[], scrollHeight:0,clientHeight:0};
  const button = { ...visible, disabled: false, click() {
    const written = textarea.value;
    sent.push(written);
    transcript += '\n' + written;
    busy=true;
    const answer = sent.length===1
      ? ('구현 완료\n'+P.BEGIN+'\nM2-T2 서명 검증 진행\n'+P.END+'\nAUTOPILOT: CONTINUE')
      : '전체 완료\nAUTOPILOT: DONE';
    timeouts.push(setTimeout(()=>{transcript+='\n'+answer;busy=false;},350));
  }};
  const doc={
    querySelector(q) {
      if(q==='main') return main;
      if(q==='#prompt-textarea') return textarea;
      if(q==='button[data-testid="stop-button"]') return busy?visible:null;
      if(q==='button[data-testid="send-button"]') return button;
      return null;
    },
    documentElement: {},
  };
  const storage={local:{
    async set(obj) {Object.assign(values,obj);},
    async get(names) {
      const keys=typeof names==='string'?[names]:names;
      return Object.fromEntries(keys.map(k=>[k,values[k]]));
    }
  }};
  const ctx={
    window:{AutoPilotProtocol:P},
    location:{origin:'https://chatgpt.com',pathname:'/c/test'},
    document:doc,
    chrome:{storage,runtime:{onMessage:{addListener(f){listener=f;}}}},
    crypto:{randomUUID:()=> 'test-run'},
    HTMLTextAreaElement:FakeTextarea,
    HTMLInputElement:class {},
    InputEvent:class {},Event:class {},
    MutationObserver:class{observe(){}},
    getComputedStyle:()=>({overflowY:'hidden'}),
    console:{info(){},warn(){},error:console.error},
    setInterval(fn,ms){const handle=setInterval(fn,ms);intervals.push(handle);return handle;},
    clearInterval,
    setTimeout(fn,ms){const handle=setTimeout(fn,ms);timeouts.push(handle);return handle;},
  };
  try {
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/content.js'),'utf8'),ctx);
    listener({action:'start',mode:'dynamic',scope:'/shared/PerpDEX',prompt:'M2-T1 마무리',limit:2,retries:1,strict:true},null,()=>{});
    for(let t=0;t<85;t++){
      if(values.autopilotPhase==='done')break;
      await new Promise(r=>setTimeout(r,200));
    }
    assert.equal(values.autopilotPhase,'done', '두 번 전송하고 DONE으로 종료해야 합니다: '+values.autopilotStatus);
    assert.equal(values.autopilotSent,2);
    assert.equal(sent.length,2);
    assert.match(sent[0], /M2-T1 마무리/);
    assert.match(sent[1], /M2-T2 서명 검증 진행/);
    assert.ok(sent.every(text=>text.includes('/shared/PerpDEX')));
    assert.equal(values.autopilotCanResume,false);
  } finally {
    for(const x of intervals)clearInterval(x);
    for(const x of timeouts)clearTimeout(x);
  }
});
