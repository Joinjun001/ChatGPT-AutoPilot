'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/protocol.js');

function response(body, status = 'CONTINUE') { return body + '\nAUTOPILOT: ' + status; }
function dynamic(prompt) { return response('작업 완료\n' + P.BEGIN + '\n' + prompt + '\n' + P.END); }

test('동적 응답에서 새로운 프롬프트 추출', () => {
  assert.deepEqual(P.parseResponse(dynamic('M2-T3 주문 API 구현'), 'dynamic'), {status:'CONTINUE', nextPrompt:'M2-T3 주문 API 구현'});
});
test('실제 로그의 ChatGPT UI footer를 제거하고 동적 프롬프트를 이어받는다', () => {
  const raw = dynamic('M2-T2 EIP-712 구현') + ' ChatGPT can make mistakes. Check important info. Latest response Thinking effort High';
  assert.deepEqual(P.parseResponse(raw, 'dynamic'), {status:'CONTINUE', nextPrompt:'M2-T2 EIP-712 구현'});
  assert.equal(P.parseResponse('완료\nAUTOPILOT: DONE\nChatGPT can make mistakes. Check important info.', 'dynamic').status, 'DONE');
  assert.equal(P.parseResponse('대기\nAUTOPILOT: BLOCKED\nChatGPT can make mistakes. Check important info. Latest response Thinking effort Medium', 'dynamic').status, 'BLOCKED');
});

test('UI footer와 다른 실제 후행 대화 내용은 잘못된 응답으로 중지한다', () => {
  assert.ok(P.parseResponse(dynamic('다음 TASK') + '\n이어지는 사용자 문장\nChatGPT can make mistakes. Check important info.', 'dynamic').error);
  assert.ok(P.parseResponse(dynamic('다음 TASK') + '\n임의의 미등록 footer', 'dynamic').error);
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

test('새로운 UI footer 조합에서 상태 및 동적 지시 파싱', () => {
  const answer = dynamic('M2-T4-D 체결 데이터 변환');
  for (const footer of [
    'Like this personality?\nChatGPT can make mistakes. Check important info. Latest response High',
    'ChatGPT can make mistakes. Check important info. Latest response Extra High',
    'Like this personality?\nChatGPT can make mistakes. Check important info. Latest response Thinking effort High',
    'ChatGPT can make mistakes. Check important info.'
  ]) {
    assert.deepEqual(P.parseResponse(answer + '\n' + footer, 'dynamic'),
      {status:'CONTINUE', nextPrompt:'M2-T4-D 체결 데이터 변환'});
  }
  assert.ok(P.parseResponse(answer + '\nUNKNOWN UI LINE\nChatGPT can make mistakes. Check important info.', 'dynamic').error);
});

test('DOM에서는 앵커 이후 Assistant 본문만 판독하여 페이지 footer와 버튼을 배제', () => {
  const turn = 1;
  const user = {
    getAttribute: name => name === 'data-message-author-role' ? 'user' : null,
    innerText: '[AUTOPILOT_MESSAGE_ID:run:' + turn + ']:END'
  };
  const reply = dynamic('M2-T4-D 구현');
  const assistant = {
    getAttribute: name => name === 'data-message-author-role' ? 'assistant' : null,
    innerText: reply + '\nCopy\nLike this personality?\nUnrecognized UI wording',
    querySelectorAll: selector => selector === '.markdown' ? [{innerText:reply}] : []
  };
  const container = {
    innerText: user.innerText + '\n' + assistant.innerText + '\nOther product UI text',
    querySelectorAll: selector => selector === '[data-message-author-role]' ? [user, assistant] : []
  };
  const actual = P.readReplyFromDom(container, 'run', turn);
  assert.equal(actual.source, 'assistant-dom');
  assert.deepEqual(P.parseResponse(actual.text, 'dynamic'), {status:'CONTINUE', nextPrompt:'M2-T4-D 구현'});
  assert.equal(actual.text, reply);

  const newUser = {getAttribute: ()=>'user', innerText:'다른 사용자 메시지'};
  const outdated = {...container, querySelectorAll:()=>[user, assistant, newUser]};
  assert.equal(P.readReplyFromDom(outdated,'run',turn).found,false);
  assert.equal(P.readReplyFromDom(container,'run',2).found,false);
});

test('Assistant 메시지가 여러 부분으로 나뉜 경우 합치고 접힌 user 식별자를 지원', () => {
  const msg = (role, innerText) => ({
    getAttribute: name => name === 'data-message-author-role' ? role : null,
    innerText,
    querySelectorAll: () => []
  });
  const user = msg('user','[AUTOPILOT_MESSAGE_ID:run:3]\n(접힌 프롬프트)');
  const first = msg('assistant','이번 회차 결과: 구현 완료');
  const last = msg('assistant',P.BEGIN+'\n다음 기능 구현\n'+P.END+'\nAUTOPILOT: CONTINUE');
  const main = {innerText:'',querySelectorAll:()=>[user,first,last]};
  const found = P.readReplyFromDom(main,'run',3);
  assert.equal(found.found,true);
  assert.equal(found.fullAnchor,false);
  assert.equal(P.parseResponse(found.text,'dynamic').nextPrompt,'다음 기능 구현');
});

test('역할 DOM이 없으면 기존 회차 식별자 및 footer 검사 경로로 복귀', () => {
  const transcript = '[AUTOPILOT_MESSAGE_ID:run:4]:END\n' +
    dynamic('재개 기능 작업') + '\nLike this personality?\nChatGPT can make mistakes. Check important info. Latest response High';
  const fallback = P.readReplyFromDom({innerText:transcript,querySelectorAll:()=>[]},'run',4);
  assert.equal(fallback.found,true);
  assert.equal(P.parseResponse(fallback.text,'dynamic').nextPrompt,'재개 기능 작업');
});
