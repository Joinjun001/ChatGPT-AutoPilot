(() => {
  if (window.__autopilotLoaded) return;
  window.__autopilotLoaded = true;

  const LOG_LIMIT = 60;
  // 줄 전체가 마커인 경우만 인정한다. 프롬프트 안의 안내 줄("AUTOPILOT: CONTINUE  (남은 작업이 있음)")이나
  // 문장 중간의 언급은 마커로 보지 않는다.
  const MARKER_RE = /^[\s*_`>-]*AUTOPILOT\s*[:：]\s*(CONTINUE|DONE|BLOCKED)[\s*_`.。!]*$/gim;

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

  // ---------- 응답 읽기 (HTML 구조에 의존하지 않음) ----------
  // ChatGPT의 메시지 요소 구조·속성은 수시로 바뀌므로, 대화 영역의 "보이는 텍스트"만 사용한다.
  // 방금 보낸 프롬프트의 첫 줄이 마지막으로 나온 위치를 기준점으로 삼고, 그 뒤의 텍스트를 응답으로 본다.

  const conversationRoot = () => document.querySelector('main') || document.body;

  // innerText는 줄바꿈을 보존한다(마커를 줄 단위로 판정하는 데 필요). 지원하지 않으면 textContent.
  const visibleText = (el) => (typeof el?.innerText === 'string' ? el.innerText : (el?.textContent || ''));

  const promptLines = () => state.prompt.split('\n').map((line) => line.trim()).filter(Boolean);

  // { found: 기준점 발견 여부, text: 기준점 이후 텍스트 }
  function readAfterPrompt() {
    const all = visibleText(conversationRoot());
    const lines = promptLines();
    const firstKey = (lines[0] || '').slice(0, 40);
    const at = firstKey ? all.lastIndexOf(firstKey) : -1;
    if (at < 0) return { found: false, text: '', total: all.length };

    let start = at + firstKey.length;
    // 프롬프트 본문이 화면에 다 펼쳐져 있으면 마지막 줄 뒤부터 응답으로 본다.
    // (접혀 있어 마지막 줄이 안 보이면 그대로 둔다. 기본 프롬프트의 안내 줄은 마커 형식이 아니어서 안전)
    const lastKey = lines.length > 1 ? lines[lines.length - 1].slice(0, 40) : '';
    if (lastKey) {
      const end = all.indexOf(lastKey, start);
      if (end >= 0) start = end + lastKey.length;
    }
    return { found: true, text: all.slice(start), total: all.length };
  }

  function currentResponseText() {
    return readAfterPrompt().text;
  }

  // 멈출 때 원인 파악용 요약
  function domSummary() {
    const { found, text, total } = readAfterPrompt();
    return found
      ? `보낸 프롬프트 찾음, 이후 ${text.length}자 (전체 ${total}자)`
      : `보낸 프롬프트를 화면 텍스트에서 찾지 못함 (전체 ${total}자)`;
  }

  // 대화 맨 아래로 스크롤해 최신 응답이 화면에 그려지게 한다.
  function scrollToLatest() {
    const button = firstVisible([
      'button[data-testid="scroll-to-bottom"]',
      'button[aria-label*="Scroll to bottom"]',
      'button[aria-label*="아래로 스크롤"]',
      'button[aria-label*="맨 아래"]'
    ]);
    if (button) button.click();

    // 스크롤 가능한 가장 큰 영역을 맨 아래로 (찾은 영역은 재사용)
    const scroller = findScroller();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  let cachedScroller = null;
  function findScroller() {
    if (cachedScroller?.isConnected && cachedScroller.scrollHeight > cachedScroller.clientHeight) return cachedScroller;
    const root = conversationRoot();
    let best = null;
    for (const el of [root, ...root.querySelectorAll('div')]) {
      if (el.scrollHeight <= el.clientHeight + 20) continue;
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      if (!best || el.clientHeight > best.clientHeight) best = el;
    }
    cachedScroller = best;
    return best;
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
