'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/protocol.js');

function response(body, status = 'CONTINUE') { return body + '\nAUTOPILOT: ' + status; }
function dynamic(prompt) { return response('작업 완료\n' + P.BEGIN + '\n' + prompt + '\n' + P.END); }

test('동적 응답에서 새로운 프롬프트 추출', () => {
  assert.deepEqual(P.parseResponse(dynamic('M2-T3 주문 API 구현'), 'dynamic'), {status:'CONTINUE', nextPrompt:'M2-T3 주문 API 구현'});
});
test('고정 모드는 기존 프롬프트를 반복한다', () => {
  assert.deepEqual(P.parseResponse(response('테스트 완료'), 'fixed'), {status:'CONTINUE', nextPrompt:null});
});
test('완료와 차단은 다음 프롬프트가 필요 없다', () => {
  assert.equal(P.parseResponse('완료\nAUTOPILOT: DONE', 'dynamic').status, 'DONE');
  assert.equal(P.parseResponse('승인 필요\nAUTOPILOT: BLOCKED', 'dynamic').status, 'BLOCKED');
});
test('중간의 마커와 마지막 상태 줄 없는 응답을 거부한다', () => {
  assert.ok(P.parseResponse('AUTOPILOT: CONTINUE\n아직 진행중', 'dynamic').error);
  assert.ok(P.parseResponse('단순 완료', 'fixed').error);
});
test('동적 모드에서 다음 프롬프트가 없으면 중지 대상으로 분류한다', () => {
  assert.ok(P.parseResponse('본문\nAUTOPILOT: CONTINUE', 'dynamic').error);
});
test('구분자 누락·역순·중복은 거부한다', () => {
  for (const text of [
    response(P.BEGIN+'\n작업'),
    response(P.END+'\n작업\n'+P.BEGIN),
    response(P.BEGIN+'\nA\n'+P.END+'\n'+P.BEGIN+'\nB\n'+P.END)
  ]) assert.ok(P.parseResponse(text,'dynamic').error);
});
test('구분자 뒤 불필요한 텍스트는 거부한다', () => {
  assert.ok(P.parseResponse(response(P.BEGIN+'\nTASK\n'+P.END+'\n별도 설명'), 'dynamic').error);
});
test('빈 텍스트 및 과도한 크기의 프롬프트 거부', () => {
  assert.ok(P.parseResponse(dynamic('   '), 'dynamic').error);
  assert.ok(P.parseResponse(dynamic('A'.repeat(8001)), 'dynamic').error);
});
test('회차별 고유 식별자를 통해 정확한 응답만 읽는다', () => {
  const first = P.composePrompt({task:'TASK A',mode:'dynamic',scope:'/shared/X',guardrails:'push 금지',runId:'run',turn:1});
  const second = P.composePrompt({task:'TASK B',mode:'dynamic',scope:'/shared/X',guardrails:'push 금지',runId:'run',turn:2});
  const transcript = first+'\nAI 첫 결과\n'+second+'\nAI 둘째 결과';
  assert.equal(P.readReply(transcript,'run',2).text, 'AI 둘째 결과');
  assert.equal(P.readReply(transcript,'run',1).found, true);
  assert.equal(P.readReply(transcript,'other',2).found, false);
});
test('메시지 끝 식별자가 안 보이면 응답 판정을 보류한다', () => {
  const text='[AUTOPILOT_MESSAGE_ID:run:3]\n긴 사용자 질문...';
  assert.equal(P.readReply(text,'run',3).found, false);
});
test('긴 사용자 메시지가 접혀 끝 식별자가 없더라도 완전한 응답 규약이 있으면 판독한다', () => {
  const collapsed = '[AUTOPILOT_MESSAGE_ID:run:4]\n사용자 메시지 일부...\n' + dynamic('다음 TASK');
  const actual = P.readReply(collapsed, 'run', 4, 'dynamic');
  assert.equal(actual.found, true);
  assert.equal(actual.partialAnchor, true);
  assert.equal(P.parseResponse(actual.text, 'dynamic').nextPrompt, '다음 TASK');
});

test('고정 작업 범위와 안전 규칙을 매 실행 프롬프트에 붙인다', () => {
  const prompt=P.composePrompt({task:'새 지시',mode:'dynamic',scope:'/shared/PerpDEX',guardrails:'실제 배포 금지',runId:'abc',turn:7});
  assert.match(prompt,/새 지시/);
  assert.match(prompt,/\/shared\/PerpDEX/);
  assert.match(prompt,/실제 배포 금지/);
  assert.match(prompt,/AUTOPILOT_NEXT_PROMPT_START/);
  assert.match(prompt,/\[AUTOPILOT_MESSAGE_ID:abc:7\]:END$/);
});
test('정규화 시 공백 차이를 동일 작업으로 판정할 수 있다', () => {
  assert.equal(P.normalize('M2-T3  구현\n테스트'),P.normalize('M2-T3 구현 테스트'));
});
