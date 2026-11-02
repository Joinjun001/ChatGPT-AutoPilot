'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../src/projects.js');
const D=require('../src/planning.js');

test('새 설치에는 미리 등록된 프로젝트가 없다',()=>{
  assert.deepEqual(P.migrate(undefined,false).profiles,[]);
  assert.deepEqual(P.normalize([]),[]);
});
test('v0.5/0.6 자동 생성 샘플만 한 차례 정리하고 사용자 수정/승인은 보존한다',()=>{
  const old=[
    {id:'salvager',name:'Project Salvager',scope:'/shared/project-salvager',approvedPlan:null},
    {id:'perpdex',name:'PerpDEX',scope:'/shared/PerpDEX',approvedPlan:null},
    {id:'salvager',name:'내 게임',scope:'/shared/my-game',approvedPlan:null},
    {id:'perpdex',name:'PerpDEX',scope:'/shared/PerpDEX',approvedPlan:{title:'확정'}}
  ];
  // 동일 scope 프로필은 중복 저장될 수 없어 승인 프로필 별도 검증
  assert.deepEqual(P.migrate(old.slice(0,3),false).profiles.map(x=>x.scope),['/shared/my-game']);
  assert.deepEqual(P.migrate([old[3]],false).profiles,[old[3]]);
  assert.equal(P.migrate(old.slice(0,2),true).profiles.length,2);
});
test('MCP 검색 결과는 기존 승인 계획을 덮어쓰지 않는다',()=>{
  const approved={title:'게임 개발',goal:'구현',milestones:['검증'],acceptanceCriteria:['QA']};
  const base=[{id:'x',name:'변경된 프로젝트명',scope:'/shared/game',approvedPlan:approved}];
  const items=D.checkDiscoveredProjects({summary:'검색 완료',projects:[
    {name:'MCP가 발견한 이름',scope:'/shared/game'},
    {name:'신규',scope:'/shared/tool'}
  ]});
  const merged=P.mergeDiscovered(base,items,()=> 'new-id');
  assert.equal(merged.added,1);
  assert.equal(merged.profiles[0].approvedPlan,approved);
  assert.equal(merged.profiles[0].name,'변경된 프로젝트명');
  assert.equal(merged.profiles[1].scope,'/shared/tool');
});
test('검색 목록은 비어 있어도 되며 경로를 검증하고 중복을 제거한다',()=>{
  assert.deepEqual(D.checkDiscoveredProjects({summary:'접근 불가',projects:[]}).projects,[]);
  const reply=D.DISCOVER_START+'\n'+JSON.stringify({summary:'MCP에서 검색',projects:[
    {name:'A',scope:'/shared/a'},{name:'A-중복',scope:'/shared/a'},{name:'B',scope:'/shared/b'}
  ]})+'\n'+D.DISCOVER_END;
  const r=D.parseReply(reply,'discover');
  assert.equal(r.value.projects.length,2);
  assert.throws(()=>D.checkDiscoveredProjects({summary:'X',projects:[{name:'위조',scope:'/tmp/x'}]}));
  assert.throws(()=>D.checkDiscoveredProjects({summary:'X',projects:[{name:'escape',scope:'/shared/../etc'}]}));
  assert.match(D.discoveryPrompt(),/읽기 전용/);
  assert.match(D.discoveryPrompt(),/프로젝트를 만들어내지 말고/);
});

test('패널에서 새 검색 버튼과 모듈이 실제로 연결되어 있다',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../sidepanel.html'),'utf8');
  assert.match(html,/id="plan-discover"/);
  assert.match(html,/src="src\/projects\.js"/);
  assert.doesNotMatch(html,/<option[^>]*>Project Salvager<\/option>/);
  assert.doesNotMatch(html,/<option[^>]*>PerpDEX<\/option>/);
});
