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

  // innerText는 화면 밖(렌더링 생략) 요소에서 비어 있을 수 있으므로 DOM 기준인 textContent를 쓴다.
  const textOf = (el) => (el?.textContent || '');
  const norm = (text) => text.replace(/\s+/g, ' ').trim();

  const USER_SEL = '[data-message-author-role="user"]';
  const ASSISTANT_SEL = '[data-message-author-role="assistant"]';
  const TURN_SEL = 'article, [data-testid^="conversation-turn"]';

  // 우리가 보낸 사용자 메시지를 찾는다. 프롬프트 앞부분이 들어 있는 가장 마지막 사용자 메시지,
  // 없으면 마지막 사용자 메시지. (빈 사용자 요소가 뒤에 끼어 있어도 기준이 빗나가지 않도록)
  function sentUserMessage() {
    const users = [...document.querySelectorAll(USER_SEL)];
    const key = norm(state.prompt).slice(0, 40);
    if (key) {
      for (let i = users.length - 1; i >= 0; i--) {
        if (norm(textOf(users[i])).includes(key)) return users[i];
      }
    }
    return users[users.length - 1] || null;
  }

  const isAfter = (anchor, el) =>
    !anchor || (Boolean(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) && !anchor.contains(el));

  // 보낸 메시지 이후의 응답 전체 텍스트.
  // 도구를 쓰는 긴 응답은 assistant 블록 여러 개로 나뉘므로 마지막 하나만 읽으면 안 된다.
  function currentResponseText() {
    const anchor = sentUserMessage();
    const blocks = [...document.querySelectorAll(ASSISTANT_SEL)].filter((el) => isAfter(anchor, el));
    if (blocks.length) return blocks.map(textOf).join('\n');

    // 역할 속성이 바뀐 경우를 대비한 fallback: 보낸 메시지 뒤의 대화 턴 중 사용자 메시지가 없는 것
    return [...document.querySelectorAll(TURN_SEL)]
      .filter((turn) => isAfter(anchor, turn) && !turn.querySelector(USER_SEL))
      .map(textOf)
      .join('\n');
  }

  // 멈출 때 원인 파악용: 화면에서 찾은 요소 개수
  function domSummary() {
    const anchor = sentUserMessage();
    const users = document.querySelectorAll(USER_SEL).length;
    const assistants = document.querySelectorAll(ASSISTANT_SEL);
    const after = [...assistants].filter((el) => isAfter(anchor, el)).length;
    return `사용자 ${users}, 응답 ${assistants.length}, 보낸 메시지 이후 응답 ${after}`;
  }

  // 대화 맨 아래로 스크롤해 최신 응답이 화면에 그려지게 한다.
  function scrollToLatest() {
    const button = firstVisible([
      'button[data-testid="scroll-to-bottom"]',
      'button[aria-label*="Scroll to bottom"]',
      'button[aria-label*="아래로 스크롤"]'
    ]);
    if (button) button.click();
    const turns = document.querySelectorAll(TURN_SEL);
    turns[turns.length - 1]?.scrollIntoView?.({ block: 'end' });
  }

  // 텍스트에서 가장 마지막에 나온 AUTOPILOT 마커를 돌려준다. 없으면 null.
  function readMarker(text) {
    const matches = [...text.matchAll(MARKER_RE)];
    return matches.length ? matches[matches.length - 1][1].toUpperCase() : null;
  }

  const tail = (text, n = 60) => text.replace(/\s+/g, ' ').trim().slice(-n);

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

  // 응답이 진짜 끝났는지 확인한다. 중지 버튼이 잠깐 사라졌다 다시 나타나는 경우(도구 호출 사이 등)와
  // 마지막 문단이 늦게 그려지는 경우를 견디도록, 화면 텍스트가 일정 시간 변하지 않을 때까지 기다린다.
  // 다시 응답 중이 되면 null을 돌려주고, 다음 종료 감지 때 재판정한다.
  async function waitForSettledResponse() {
    const SETTLE_WITH_MARKER_MS = 2500;
    const SETTLE_WITHOUT_MARKER_MS = 10000;
    const deadline = Date.now() + 45000;
    let lastText = null;
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      if (!state.running || isBusy()) return null;
      scrollToLatest();
      const text = currentResponseText();
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      } else {
        const need = readMarker(text) ? SETTLE_WITH_MARKER_MS : SETTLE_WITHOUT_MARKER_MS;
        if (Date.now() - stableSince >= need) break;
      }
      await delay(500);
    }
    return lastText ?? '';
  }

  let finishing = false;

  async function onResponseFinished() {
    if (!state.running || finishing) return;
    finishing = true;
    try {
      await setStatus('응답 종료 감지, 마지막 줄 확인 중');
      const text = await waitForSettledResponse();
      if (text === null || !state.running) return;
      await decideNext(text);
    } finally {
      finishing = false;
    }
  }

  async function decideNext(text) {
    const marker = readMarker(text);

    if (marker === 'DONE') return stop('ChatGPT가 프로젝트 완료(AUTOPILOT: DONE)를 보고했습니다', 'done');
    if (marker === 'BLOCKED') return stop('ChatGPT가 진행 불가(AUTOPILOT: BLOCKED)를 보고했습니다. 응답을 확인하세요', 'blocked');
    if (!marker && state.strict && state.sent > 0) {
      const seen = tail(text);
      return stop(`응답에 AUTOPILOT 상태 줄이 없습니다 (도구 승인 대기·오류 가능). 읽은 끝부분: "${seen || '(비어 있음)'}" [${domSummary()}]`, 'blocked');
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
      void onResponseFinished();
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
