'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../src/planning.js');
const C_SOURCE=fs.readFileSync(require.resolve('../src/composer-ui.js'),'utf8');

test('Plan Mode는 질문→계획 응답을 저장하지만 개발 루프를 실행하지 않는다', {timeout:20000}, async()=>{
  let transcript='',listener;
  const values={autopilotRunning:false};
  let sent=[];
  class Textarea {
    constructor(){this._value='';this.tagName='TEXTAREA';}
    get value(){return this._value;}
    set value(x){this._value=x;}
    getClientRects(){return [1];}
    focus(){}
    dispatchEvent(){}
  }
  const el=new Textarea();
  const main={get innerText(){return transcript;},querySelectorAll(){return [];}};
  const button={disabled:false,getClientRects(){return [1];},click(){
    sent.push(el.value);
    transcript+='\n'+el.value;
    const output=sent.length===1
      ? D.QUESTION_START+'\n'+JSON.stringify({summary:'Godot 3D 프로젝트',questions:[{question:'개발 목표?',options:['맵','에셋','플레이']} ]})+'\n'+D.QUESTION_END
      : D.RESULT_START+'\n'+JSON.stringify({title:'플레이 경험',goal:'완성도 향상',milestones:['기능 결합'],acceptanceCriteria:['실제 플레이 검증']})+'\n'+D.RESULT_END;
    setTimeout(()=>{transcript+='\n'+output;},250);
  }};
  const context={
    window:{AutoPilotPlanning:D},
    document:{querySelector(query){
      if(query==='main')return main;
      if(query==='#prompt-textarea')return el;
      if(query==='button[data-testid="send-button"]')return button;
      return null;
    },body:main},
    chrome:{storage:{local:{
      async get(){return {...values};},
      async set(o){Object.assign(values,o);}
    }},runtime:{onMessage:{addListener(f){listener=f;}}}},
    crypto:{randomUUID:()=>String(sent.length+1)},
    HTMLTextAreaElement:Textarea,
    HTMLInputElement:class{},
    InputEvent:class {},Event:class {},
    setTimeout,
    console
  };
  vm.runInNewContext(C_SOURCE,context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/plan-runner.js'),'utf8'),context);
  async function waitFor(phase){
    for(let i=0;i<100;i++){
      if(values.autopilotPlanPhase===phase)return;
      if(values.autopilotPlanPhase==='error')throw Error(values.autopilotPlanStatus);
      await new Promise(r=>setTimeout(r,70));
    }
    throw Error('대기 시간 초과: '+values.autopilotPlanPhase+' '+values.autopilotPlanStatus);
  }
  listener({action:'planAnalyze',scope:'/shared/project-salvager'},null,()=>{});
  // 동일 버튼을 빠르게 두 번 눌러도 단발 전송이어야 한다.
  listener({action:'planAnalyze',scope:'/shared/project-salvager'},null,()=>{});
  await waitFor('questions');
  assert.equal(values.autopilotPlanQuestions.questions[0].options[2],'플레이');
  assert.equal(sent.length,1);
  assert.match(sent[0],/읽기 전용/);
  listener({action:'planFinalize',scope:'/shared/project-salvager',questions:values.autopilotPlanQuestions,answers:['플레이']},null,()=>{});
  await waitFor('review');
  assert.equal(values.autopilotPlanResult.title,'플레이 경험');
  assert.equal(sent.length,2);
  assert.match(sent[1],/코드를 수정·커밋·push·배포하지 마세요/);
  assert.equal(values.autopilotRunning,false);
});
test('AutoPilot 실행 중에는 설계 요청을 보내지 않는다', {timeout:2000},async()=>{
  const values={autopilotRunning:true};
  let listener;
  const context={
    window:{AutoPilotPlanning:D},
    document:{querySelector(){return null;}},
    chrome:{storage:{local:{async get(){return values;},async set(o){Object.assign(values,o);}}},runtime:{onMessage:{addListener(f){listener=f;}}}},
    crypto:{randomUUID:()=> 'id'},
    setTimeout,console
  };
  vm.runInNewContext(C_SOURCE,context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/plan-runner.js'),'utf8'),context);
  listener({action:'planAnalyze',scope:'/shared/PerpDEX'},null,()=>{});
  await new Promise(r=>setTimeout(r,100));
  assert.equal(values.autopilotPlanPhase,'error');
  assert.match(values.autopilotPlanStatus,/AutoPilot이 실행 중/);
});

test('프로젝트 검색은 실제 형식 응답만 저장하고 Plan Mode 상태를 덮어쓰지 않는다', {timeout:12000}, async()=>{
  let listener,transcript='',sent=0;
  const values={autopilotRunning:false,autopilotPlanPhase:'review',autopilotPlanResult:{title:'기존 승인 계획'}};
  class Textarea {
    constructor(){this._value='';this.tagName='TEXTAREA';}
    get value(){return this._value;}
    set value(v){this._value=v;}
    getClientRects(){return [1];}
    focus(){}
    dispatchEvent(){}
  }
  const el=new Textarea();
  const main={get innerText(){return transcript;},querySelectorAll(){return [];}};
  const button={disabled:false,getClientRects(){return [1];},click(){
    sent++;
    transcript+='\n'+el.value;
    setTimeout(()=>{
      transcript+='\n'+D.DISCOVER_START+'\n'+JSON.stringify({
        summary:'MCP로 실제 프로젝트 2개 조회',
        projects:[{name:'Game',scope:'/shared/game'},{name:'Backend',scope:'/shared/backend'}]
      })+'\n'+D.DISCOVER_END;
    },100);
  }};
  const context={
    window:{AutoPilotPlanning:D},
    document:{querySelector(sel){
      if(sel==='main')return main;
      if(sel==='#prompt-textarea')return el;
      if(sel==='button[data-testid="send-button"]')return button;
      return null;
    },body:main},
    chrome:{storage:{local:{
      async get(){return {...values};},
      async set(o){Object.assign(values,o);}
    }},runtime:{onMessage:{addListener(f){listener=f;}}}},
    crypto:{randomUUID:()=>String(sent+1)},
    HTMLTextAreaElement:Textarea,HTMLInputElement:class{},
    InputEvent:class{},Event:class{},setTimeout,console
  };
  vm.runInNewContext(C_SOURCE,context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/plan-runner.js'),'utf8'),context);
  listener({action:'planDiscover'},null,()=>{});
  listener({action:'planDiscover'},null,()=>{});
  for(let i=0;i<110 && values.autopilotDiscoverPhase!=='results';i++){
    if(values.autopilotDiscoverPhase==='error')throw Error(values.autopilotDiscoverStatus);
    await new Promise(r=>setTimeout(r,60));
  }
  assert.equal(values.autopilotDiscoverPhase,'results');
  assert.equal(sent,1);
  assert.equal(values.autopilotDiscoveredProjects.projects.length,2);
  assert.equal(values.autopilotPlanPhase,'review');
  assert.equal(values.autopilotPlanResult.title,'기존 승인 계획');
  assert.equal(values.autopilotRunning,false);
});
