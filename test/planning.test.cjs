'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/planning.js');
test('경로 검증은 /shared 하위 유효 프로젝트만 허용한다', () => {
  assert.equal(D.validScope('/shared/project-salvager'),true);
  for (const path of ['/tmp/project','/shared/../etc','/shared/x;rm','/shared/x\nrule','', '/shared/'])
    assert.equal(D.validScope(path),false,path);
});
test('AI 설계 질문은 프로젝트 분석 결과로부터 생성·검증한다', () => {
  const reply='분석\n'+D.QUESTION_START+'\n'+JSON.stringify({summary:'Godot 3D 게임',questions:[{question:'어떤 목표?',options:['맵', '에셋','플레이']} ]})+'\n'+D.QUESTION_END;
  const out=D.parseReply(reply,'questions');
  assert.equal(out.value.questions[0].options.length,3);
  assert.equal(out.value.questions[0].id,'q1');
  assert.equal(D.parseReply('아직 응답중','questions').ready,false);
  assert.ok(D.parseReply(reply+reply,'questions').error);
});
test('누락·초과·잘못된 JSON 질문은 거부한다', () => {
  const mk=x=>D.QUESTION_START+JSON.stringify(x)+D.QUESTION_END;
  assert.ok(D.parseReply(mk({summary:'x',questions:[]}), 'questions').error);
  assert.ok(D.parseReply(mk({summary:'x',questions:[{question:'Q',options:['A','B']}]}), 'questions').error);
  assert.ok(D.parseReply(D.QUESTION_START+'{broken'+D.QUESTION_END,'questions').error);
});
test('확정 계획은 마일스톤·완료기준이 있어야 한다', () => {
  const plan={title:'레벨 재설계',goal:'동선 개선',milestones:['신규 구역','실제 렌더 확인'],acceptanceCriteria:['Godot 씬 로드','이전 대비 이미지']};
  assert.equal(D.checkPlan(plan).title,plan.title);
  const reply=D.RESULT_START+'\n'+JSON.stringify(plan)+'\n'+D.RESULT_END;
  assert.equal(D.parseReply(reply,'result').value.milestones.length,2);
  const prompt=D.executionPrompt('/shared/project-salvager', plan);
  assert.match(prompt,/실제 산출물/);
  assert.match(prompt,/push·배포/);
  assert.match(prompt,/사용자 대신 승인 메시지/);
  assert.throws(()=>D.checkPlan({...plan,acceptanceCriteria:[]}));
});
test('질문 응답과 계획 생성은 쓰기 금지를 유지한다', () => {
  const first=D.analysisPrompt('/shared/PerpDEX');
  assert.match(first,/읽기 전용/);
  assert.match(first,/선택지 정확히 3개/);
  const next=D.finalizePrompt('/shared/PerpDEX',[{question:'목표는?'}],['체결 무결성'],'현재 API 구현');
  assert.match(next,/체결 무결성/);
  assert.match(next,/수정·커밋·push·배포하지 마세요/);
  assert.throws(()=>D.finalizePrompt('/shared/X',[{question:'Q'}],['']));
});
