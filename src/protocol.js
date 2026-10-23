/* 응답 판독은 별도 순수 함수로 유지하여 브라우저 없이 테스트한다. */
(function (root) {
  'use strict';
  const TERMINAL = /(?:^|\n)[ \t>*_`]*AUTOPILOT\s*[:：]\s*(CONTINUE|DONE|BLOCKED)[ \t*_`.。!]*$/i;
  const BEGIN = 'AUTOPILOT_NEXT_PROMPT_START';
  const END = 'AUTOPILOT_NEXT_PROMPT_END';
  const MAX_PROMPT = 8000;

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseResponse(raw, mode) {
    const text = String(raw || '').trim();
    const terminal = text.match(TERMINAL);
    if (!terminal) return { status: null, error: '응답 마지막에 유효한 AUTOPILOT 상태 줄이 없습니다.' };
    const status = terminal[1].toUpperCase();
    if (status !== 'CONTINUE') return { status, nextPrompt: null };
    if (mode !== 'dynamic') return { status, nextPrompt: null };
    const before = text.slice(0, terminal.index).trimEnd();
    const starts = before.split(BEGIN).length - 1;
    const ends = before.split(END).length - 1;
    if (starts !== 1 || ends !== 1) {
      return { status, error: '다음 프롬프트 구분자는 정확히 한 쌍이어야 합니다.' };
    }
    const start = before.indexOf(BEGIN);
    const end = before.indexOf(END);
    if (end <= start || before.slice(end + END.length).trim()) {
      return { status, error: '다음 프롬프트 블록은 상태 줄 바로 앞에 있어야 합니다.' };
    }
    const nextPrompt = before.slice(start + BEGIN.length, end).trim();
    if (!nextPrompt || nextPrompt.length > MAX_PROMPT) {
      return { status, error: '다음 프롬프트가 비었거나 8,000자를 초과합니다.' };
    }
    return { status, nextPrompt };
  }

  function composePrompt(options) {
    const { task, mode, scope, runId, turn, guardrails } = options;
    const id = '[AUTOPILOT_MESSAGE_ID:' + runId + ':' + turn + ']';
    const fixed = String(guardrails || '').trim();
    const parts = [id, String(task || '').trim()];
    if (scope) parts.push('[고정 작업 범위]\n' + scope);
    if (fixed) parts.push('[매 회차 고정 안전 규칙]\n' + fixed);
    if (mode === 'dynamic') {
      parts.push('[응답 규약]\n실행 가능한 다음 단계가 있으면 응답 마지막에 ' +
        BEGIN + ' 한 줄, 다음 작업을 지시하는 텍스트, ' + END +
        ' 한 줄, 그리고 마지막 줄에 AUTOPILOT: CONTINUE를 순서대로 출력하세요. ' +
        '모든 작업 완료면 마지막 줄에 AUTOPILOT: DONE, 사람의 승인이나 실제 권한이 없어서 ' +
        '할 수 있는 작업이 전혀 없으면 마지막 줄에 AUTOPILOT: BLOCKED를 출력하세요. ' +
        '구분자와 마지막 상태 줄은 코드 블록 밖에 출력하세요.');
    }
    parts.push(id + ':END');
    return parts.join('\n\n');
  }

  function readReply(transcript, runId, turn, mode = 'dynamic') {
    const all = String(transcript || '');
    const id = '[AUTOPILOT_MESSAGE_ID:' + runId + ':' + turn + ']';
    const endMarker = id + ':END';
    const end = all.lastIndexOf(endMarker);
    if (end >= 0) {
      return { found: true, text: all.slice(end + endMarker.length).trim(), fullAnchor: true };
    }
    const start = all.lastIndexOf(id);
    if (start < 0) return { found: false, text: '', fullAnchor: false };
    // ChatGPT가 긴 사용자 메시지를 접어 끝 식별자가 사라지면 시작 식별자 이후를 재검사한다.
    // 마지막 AI 상태 및 동적 블록까지 모두 유효할 때만 허용한다. 아니면 안전하게 판독 보류.
    const candidate = all.slice(start + id.length).trim();
    const parsed = parseResponse(candidate, mode);
    if (!parsed.status || parsed.error) return { found: false, text: '', fullAnchor: false, partialAnchor: true };
    return { found: true, text: candidate, fullAnchor: false, partialAnchor: true };
  }

  const api = { parseResponse, composePrompt, readReply, normalize, BEGIN, END, MAX_PROMPT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AutoPilotProtocol = api;
})(typeof window !== 'undefined' ? window : null);
