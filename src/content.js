(() => {
  if (window.__autopilotLoaded) return;
  window.__autopilotLoaded = true;

  const LOG_LIMIT = 60;
  const MARKER_RE = /AUTOPILOT\s*:\s*(CONTINUE|DONE|BLOCKED)/gi;

  let state = { running: false, sent: 0, limit: 0, prompt: '', strict: true };
  let lastBusy = false;
  let seenBusy = false;
  let sending = false;
  let log = [];

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- 상태 기록 ----------

  async function setStatus(message, phase = state.running ? 'running' : 'idle') {
    console.info('[AutoPilot]', message);
    log.push({ t: Date.now(), m: message });
    if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
    try {
      await chrome.storage.local.set({
        autopilotStatus: message,
        autopilotPhase: phase,
        autopilotSent: state.sent,
        autopilotRunLimit: state.limit,
        autopilotRunning: state.running,
        autopilotLog: log
      });
    } catch {}
  }

  async function stop(reason, phase = 'stopped') {
    state.running = false;
    await setStatus(`중지: ${reason}`, phase);
  }

  // ---------- ChatGPT DOM 탐색 ----------

  const firstVisible = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  const composer = () => firstVisible([
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'form[data-chatgpt-composer] [contenteditable="true"]',
    'textarea#prompt-textarea'
  ]);

  const stopButton = () => firstVisible([
    'button[data-testid="stop-button"]',
    'button[data-testid*="stop"]',
    '#composer-submit-button[aria-label*="Stop"]',
    '#composer-submit-button[aria-label*="중지"]',
    'button[aria-label*="Stop generating"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="중지"]'
  ]);

  const sendButton = () => firstVisible([
    'button[data-testid="send-button"]',
    'button[data-testid*="send-button"]',
    '#composer-submit-button',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button[aria-label="프롬프트 보내기"]',
    'button[aria-label="메시지 보내기"]'
  ]);

  const isBusy = () => Boolean(stopButton());

  const isDisabled = (button) =>
    !button || button.disabled || button.getAttribute('aria-disabled') === 'true';

  function lastAssistantText() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = messages[messages.length - 1];
    return last ? (last.innerText || last.textContent || '') : '';
  }

  // 응답 안에서 가장 마지막에 나온 AUTOPILOT 마커를 돌려준다. 없으면 null.
  function readMarker() {
    const matches = [...lastAssistantText().matchAll(MARKER_RE)];
    return matches.length ? matches[matches.length - 1][1].toUpperCase() : null;
  }

  // ---------- 입력/전송 ----------

  function fillComposer(el, text) {
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);

    document.execCommand('delete', false, null);
    const inserted = document.execCommand('insertText', false, text);

    if (!inserted || !(el.textContent || '').trim()) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    }

    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitFor(check, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = check();
      if (value) return value;
      await delay(150);
    }
    return null;
  }

  async function send() {
    if (!state.running || sending || isBusy()) return;
    if (state.sent >= state.limit) return stop('최대 전송 횟수 도달');

    sending = true;
    try {
      const el = composer();
      if (!el) return stop('ChatGPT 입력창을 찾지 못했습니다', 'error');

      fillComposer(el, state.prompt);
      await delay(300);

      const visibleText = (el.value ?? el.textContent ?? '').trim();
      if (!visibleText) return stop('입력창에 텍스트를 넣지 못했습니다', 'error');

      const button = await waitFor(() => {
        const b = sendButton();
        return b && !isDisabled(b) ? b : null;
      }, 5000);
      if (!button) return stop('활성화된 전송 버튼을 찾지 못했습니다', 'error');

      button.click();
      state.sent += 1;

      if (!(await waitFor(isBusy, 4000))) {
        return stop('전송 후 응답 시작을 확인하지 못했습니다', 'error');
      }

      seenBusy = true;
      lastBusy = true;
      await setStatus(`${state.sent}번째 전송 완료, 응답 생성 중`);
    } catch (error) {
      await stop(`예외 발생: ${error?.message || String(error)}`, 'error');
    } finally {
      sending = false;
    }
  }

  // ---------- 응답 종료 처리 ----------

  async function onResponseFinished() {
    if (!state.running || isBusy()) return;

    const marker = readMarker();

    if (marker === 'DONE') return stop('ChatGPT가 프로젝트 완료(AUTOPILOT: DONE)를 보고했습니다', 'done');
    if (marker === 'BLOCKED') return stop('ChatGPT가 진행 불가(AUTOPILOT: BLOCKED)를 보고했습니다. 응답을 확인하세요', 'blocked');
    if (!marker && state.strict && state.sent > 0) {
      return stop('응답에 AUTOPILOT 상태 줄이 없습니다 (도구 승인 대기·오류 가능). 화면을 확인하세요', 'blocked');
    }
    if (state.sent >= state.limit) return stop('최대 전송 횟수까지 작업 완료');

    await setStatus(`응답 완료${marker ? ` (${marker})` : ''}, 다음 단계 전송`);
    void send();
  }

  function tick() {
    if (!state.running) return;

    const nowBusy = isBusy();
    if (nowBusy) seenBusy = true;

    if (lastBusy && !nowBusy && seenBusy && !sending) {
      seenBusy = false;
      // 마지막 문단이 화면에 다 그려질 시간을 준 뒤 마커를 읽는다.
      setTimeout(() => void onResponseFinished(), 1500);
    }

    lastBusy = nowBusy;
  }

  new MutationObserver(tick).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label', 'aria-disabled', 'disabled', 'data-testid']
  });
  setInterval(tick, 1000);

  // ---------- 사이드 패널 메시지 ----------

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.action === 'stop') {
      void stop('사용자 요청');
      reply({ message: '중지했습니다' });
      return;
    }

    if (message.action === 'start') {
      state = {
        running: true,
        sent: 0,
        limit: message.limit,
        prompt: message.prompt,
        strict: message.strict !== false
      };
      log = [];
      lastBusy = isBusy();
      seenBusy = lastBusy;

      if (lastBusy) {
        void setStatus('시작: 현재 응답이 끝나면 첫 프롬프트를 보냅니다');
        reply({ message: '현재 응답이 끝나기를 기다립니다' });
      } else {
        void setStatus('시작: 첫 프롬프트를 보냅니다');
        reply({ message: '첫 프롬프트를 보냅니다' });
        setTimeout(() => void send(), 300);
      }
    }
  });
})();
