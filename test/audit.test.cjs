'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../src/audit.js');
test('이벤트에는 정해진 메타데이터만 기록하고 명령/자격증명은 제외한다',()=>{
  const x=A.sanitize({event:'turn_result',runId:'run-001',turn:18,status:'BLOCKED',
    cmd:'echo PRIVATE_TOKEN=secret',secret:'topsecret',prompt:'민감한 코드',output:'secret'});
  assert.equal(x.event,'turn_result');
  assert.equal(x.turn,18);
  assert.ok(!JSON.stringify(x).includes('secret'));
  assert.ok(!('cmd' in x));
});
test('로컬 이벤트 저장은 순차화되고 최근 1000개만 유지한다',async()=>{
  const store={},chrome={storage:{local:{
    async get(){return {...store};},
    async set(x){Object.assign(store,x);}
  }}};
  await Promise.all(Array.from({length:1005},(_,i)=>A.record(chrome,{event:'state',turn:i,runId:'abc'})));
  assert.equal(store.autopilotAuditEvents.length,1000);
  assert.equal(store.autopilotAuditEvents[0].turn,5);
  assert.equal(store.autopilotAuditEvents.at(-1).turn,1004);
  const text=A.toJsonl(store.autopilotAuditEvents);
  assert.equal(text.trim().split('\n').length,1000);
});

test('요약은 실행 ID별 전송·응답 및 차단 상태를 집계한다',()=>{
  const events=[
    {runId:'run1',event:'run_start',time:'t1',scope:'/shared/PerpDEX'},
    {runId:'run1',event:'turn_sent',time:'t2'},
    {runId:'run1',event:'turn_result',status:'BLOCKED',time:'t3'},
    {runId:'run1',event:'run_end',status:'blocked',time:'t4'}
  ];
  assert.deepEqual(A.summary(events)[0],{
    runId:'run1',scope:'/shared/PerpDEX',started:'t1',lastSeen:'t4',
    turnsSent:1,turnsFinished:1,blocked:1,errors:0,completed:false
  });
});
