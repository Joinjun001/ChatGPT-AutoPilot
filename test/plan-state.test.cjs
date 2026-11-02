'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../src/planning.js');
const P=require('../src/projects.js');

const scopeA='/shared/ChatGPT-AutoPilot';
const scopeB='/shared/PerpDEX';
const key=(scope,field)=>'autopilotPlan'+field+':'+scope;
const questions={
  summary:'분석 완료',
  questions:[
    {question:'우선 개발?',options:['안정성','기능','성능']},
    {question:'권한 수준?',options:['읽기 전용','현재 유지','세분화']},
    {question:'오류 대응?',options:['복구','기록','통제']}
  ]
};
const plan={
  title:'복원 강화',goal:'사이드패널 상태 보존',
  milestones:['질문 복원','회귀 테스트'],
  acceptanceCriteria:['창을 재개방해도 질문 유지']
};
const profiles=[
  {id:'a',name:'ChatGPT-AutoPilot',scope:scopeA,approvedPlan:null},
  {id:'b',name:'PerpDEX',scope:scopeB,approvedPlan:null}
];

function panel(store){
  let alive=true;
  const listeners=[];
  const els={},handlers={};
  function el(tag){
    return {
      tagName:tag.toUpperCase(),value:'',name:'',type:'',checked:false,
      textContent:'',hidden:false,disabled:false,style:{},dataset:{},children:[],
      listeners:{},
      addEventListener(name,fn){this.listeners[name]=fn;},
      fire(name){this.listeners[name]?.();},
      append(...children){this.children.push(...children);},
      replaceChildren(){this.children=[];},
      dispatchEvent(){},
      querySelectorAll(selector){
        const m=selector.match(/^(input|textarea)(?:\[name="([^"]+)"\]|\[data-question-index="([^"]+)"\])?(:checked)?$/);
        if(!m)return [];
        const matches=[];
        const walk=(node)=>{
          if(node.tagName===m[1].toUpperCase() &&
             (!m[2] || node.name===m[2]) &&
             (!m[3] || node.dataset?.questionIndex===m[3]) &&
             (!m[4] || node.checked))matches.push(node);
          for(const child of node.children||[])walk(child);
        };
        walk(this);
        return matches;
      },
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    };
  }
  const ids=[
    'plan-project','plan-name','plan-scope','plan-save','plan-discover',
    'plan-discover-status','plan-analyze','plan-status','plan-summary',
    'plan-questions','plan-submit','plan-review','plan-result','plan-approve',
    'plan-start','scope','mode','prompt','start'
  ];
  for(const id of ids){
    els[id]=el(id);
    els[id].addEventListener=(name,fn)=>{handlers[id]??={};handlers[id][name]=fn;};
  }
  const doc={
    querySelector(q){return els[q.replace(/^#/,'')]||null;},
    createElement:el,
    createTextNode(s){return {textContent:s,children:[]};}
  };
  const chrome={
    storage:{
      local:{
        async get(keys){
          const output={};
          for(const k of keys)if(Object.hasOwn(store,k))output[k]=store[k];
          return output;
        },
        async set(obj){
          const changes=Object.fromEntries(Object.entries(obj).map(([k,v])=>
            [k,{oldValue:store[k],newValue:v}]));
          Object.assign(store,obj);
          for(const fn of listeners)queueMicrotask(()=>{if(alive)fn(changes,'local');});
        }
      },
      onChanged:{addListener(fn){listeners.push(fn);}}
    },
    tabs:{
      async query(){return [{id:17,url:'https://chatgpt.com/c/example'}];},
      async sendMessage(){return {message:'전송 완료'};}
    }
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/plan-panel.js'),'utf8'),
    {window:{AutoPilotPlanning:D,AutoPilotProjects:P},document:doc,chrome,
      crypto:{randomUUID:()=>'generated-id'},
      Event:class{constructor(type){this.type=type;}},
      console,queueMicrotask}
  );
  return {els,handlers,store,close(){alive=false;},
    updateStorage(o){return chrome.storage.local.set(o);},
    questions(){return els['plan-questions'].children;}};
}
async function settle(){await new Promise(r=>setTimeout(r,30));}
function initial(){
  return {
    autopilotProfiles:structuredClone(profiles),
    autopilotSelectedProject:'a',autopilotProfilesMigrated:true,
    autopilotDiscoverPhase:'results',
    autopilotDiscoveredProjects:{summary:'검색 완료',projects:[{name:'ChatGPT-AutoPilot',scope:scopeA}]},
    [key(scopeA,'Questions')]:structuredClone(questions),
    [key(scopeA,'Result')]:null,
    [key(scopeA,'Phase')]:'questions',
    [key(scopeA,'Status')]:'질문 선택 대기'
  };
}

test('프로젝트 검색 결과가 있어도 사이드패널 재개방 후 질문 3개를 유지한다',async()=>{
  const store=initial();
  const x=panel(store);await settle();
  assert.equal(x.questions().length,3);
  assert.equal(x.els['plan-submit'].hidden,false);
  x.close();
  const y=panel(store);await settle();
  assert.equal(y.questions().length,3);
  assert.equal(y.els['plan-submit'].hidden,false);
  assert.equal(y.els['plan-project'].value,'a');
  y.close();
});

test('검색 결과 갱신으로 기존 질문과 선택이 초기화되지 않는다',async()=>{
  const store=initial();
  const x=panel(store);await settle();
  const original=x.questions()[0];
  const updated={summary:'다시 검색 완료',projects:[
    {name:'ChatGPT-AutoPilot',scope:scopeA},{name:'PerpDEX',scope:scopeB}
  ]};
  await x.updateStorage({
    autopilotDiscoverPhase:'results',autopilotDiscoveredProjects:updated
  });
  await settle();
  assert.equal(x.questions().length,3);
  assert.equal(x.questions()[0],original);
  assert.equal(x.els['plan-project'].value,'a');
  assert.equal(x.els['plan-summary'].textContent,'분석 완료');
  x.close();
  const y=panel(store);await settle();
  assert.equal(y.questions().length,3);
  y.close();
});

test('라디오 선택과 직접 입력을 프로젝트별로 저장하고 재개방 후 복원한다',async()=>{
  const store=initial();
  const x=panel(store);await settle();
  const q1=x.questions()[0];
  const radio=q1.querySelectorAll('input[name="plan-q0"]');
  radio.forEach(r=>r.checked=false);
  radio[2].checked=true;radio[2].fire('change');
  const q2=x.questions()[1];
  const custom=q2.querySelectorAll('input[name="plan-q1"]')[3];
  const textarea=q2.querySelector('textarea[data-question-index="1"]');
  textarea.value='읽기 전용 MCP와 쓰기 권한 분리';
  textarea.fire('input');
  await settle();
  assert.equal(store[key(scopeA,'Answers')][0].selected,'2');
  assert.equal(store[key(scopeA,'Answers')][1].selected,'custom');
  assert.equal(store[key(scopeA,'Answers')][1].custom,'읽기 전용 MCP와 쓰기 권한 분리');
  x.close();
  const y=panel(store);await settle();
  assert.equal(y.questions()[0].querySelector('input[name="plan-q0"]:checked').value,'2');
  assert.equal(y.questions()[1].querySelector('input[name="plan-q1"]:checked').value,'custom');
  assert.equal(y.questions()[1].querySelector('textarea[data-question-index="1"]').value,
    '읽기 전용 MCP와 쓰기 권한 분리');
  y.close();
});

test('프로젝트를 전환해도 타 프로젝트의 질문이 섞이지 않는다',async()=>{
  const store=initial();
  store[key(scopeB,'Questions')]={summary:'PerpDEX 분석',questions:[{question:'시장?',options:['A','B','C']}]};
  store[key(scopeB,'Phase')]='questions';
  const x=panel(store);await settle();
  x.els['plan-project'].value='b';
  x.handlers['plan-project'].change();
  await settle();
  assert.equal(x.questions().length,1);
  assert.equal(x.els['plan-summary'].textContent,'PerpDEX 분석');
  x.els['plan-project'].value='a';
  x.handlers['plan-project'].change();
  await settle();
  assert.equal(x.questions().length,3);
  assert.equal(x.els['plan-summary'].textContent,'분석 완료');
  x.close();
});

test('v0.6.3 전역 저장 질문을 선택 프로젝트의 독립 키로 마이그레이션한다',async()=>{
  const store={
    autopilotProfiles:structuredClone(profiles),autopilotSelectedProject:'a',
    autopilotProfilesMigrated:true,autopilotPlanScope:scopeA,
    autopilotPlanPhase:'questions',autopilotPlanStatus:'기존 질문',
    autopilotPlanQuestions:structuredClone(questions),
    autopilotPlanResult:null,
    autopilotDiscoverPhase:'results',
    autopilotDiscoveredProjects:{summary:'기존 검색 결과',projects:[]}
  };
  const x=panel(store);await settle();
  assert.equal(x.questions().length,3);
  assert.equal(store[key(scopeA,'Questions')].questions.length,3);
  x.close();
});

test('생성된 계획과 승인 계획을 재개방 후 표시한다',async()=>{
  const store=initial();
  store[key(scopeA,'Result')]=structuredClone(plan);
  store[key(scopeA,'Phase')]='review';
  const x=panel(store);await settle();
  assert.equal(x.els['plan-review'].hidden,false);
  assert.equal(x.els['plan-submit'].hidden,true);
  assert.equal(x.questions().length,0);
  x.handlers['plan-approve'].click();
  await settle();
  assert.equal(store.autopilotProfiles[0].approvedPlan.title,plan.title);
  x.close();
  const y=panel(store);await settle();
  assert.equal(y.els['plan-review'].hidden,false);
  assert.equal(y.els['plan-start'].disabled,false);
  y.close();
});
