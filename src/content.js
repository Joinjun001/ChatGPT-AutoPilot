(() => {
  if (window.__autopilotLoaded) return;
  window.__autopilotLoaded = true;

  let state = { running: false, sent: 0, limit: 3, prompt: '' };
  let lastBusy = false;
  let seenBusy = false;
  let sending = false;

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function setStatus(message) {
    console.info('[AutoPilot]', message);
    try {
      await chrome.storage.local.set({ autopilotStatus: message, autopilotSent: state.sent, autopilotRunning: state.running });
    } catch {}
  }

  const composer = () => {
    const selectors = [
      '#prompt-textarea',
      '[data-testid="prompt-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'form[data-chatgpt-composer] [contenteditable="true"]',
      'textarea#prompt-textarea'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  const stopButton = () => {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[data-testid*="stop"]',
      '#composer-submit-button[aria-label*="Stop"]',
      '#composer-submit-button[aria-label*="중지"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="중지"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  const isBusy = () => Boolean(stopButton());

  const sendButton = () => {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[data-testid*="send-button"]',
      '#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[aria-label="프롬프트 보내기"]',
      'button[aria-label="메시지 보내기"]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };

  function isDisabled(button) {
    if (!button) return true;
    return button.disabled || button.getAttribute('aria-disabled') === 'true';
  }

  function fillComposer(el, text) {
    el.focus();

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, text);
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
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    }

    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitForSendButton(timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const button = sendButton();
      if (button && !isDisabled(button)) return button;
      await delay(150);
    }
    return null;
  }

  async function waitForBusyStart(timeoutMs = 4000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (isBusy()) return true;
      await delay(150);
    }
    return false;
  }

  async function stop(reason) {
    state.running = false;
    await setStatus(`중지: ${reason}`);
  }

  async function send() {
    if (!state.running || sending || isBusy()) return;
    if (state.sent >= state.limit) return stop('최대 전송 횟수 도달');

    sending = true;
    try {
      await setStatus('입력창 탐색 중');
      const el = composer();
      if (!el) return stop('ChatGPT 입력창을 찾지 못했습니다');

      await setStatus('프롬프트 입력 중');
      fillComposer(el, state.prompt);
      await delay(300);

      const visibleText = (el.value ?? el.textContent ?? '').trim();
      if (!visibleText) return stop('입력창에 텍스트를 넣지 못했습니다');

      await setStatus('전송 버튼 대기 중');
      const button = await waitForSendButton();
      if (!button) return stop('활성화된 전송 버튼을 찾지 못했습니다');

      button.click();
      state.sent += 1;
      await setStatus(`전송 클릭 완료 (${state.sent}/${state.limit})`);

      const started = await waitForBusyStart();
      if (!started) {
        return stop('전송 클릭 후 응답 시작을 확인하지 못했습니다');
      }

      seenBusy = true;
      lastBusy = true;
      await setStatus(`응답 생성 중 (${state.sent}/${state.limit})`);

      if (state.sent >= state.limit) {
        await setStatus(`마지막 전송 완료, 현재 응답 종료 대기 (${state.sent}/${state.limit})`);
      }
    } catch (error) {
      await stop(`예외 발생: ${error?.message || String(error)}`);
    } finally {
      sending = false;
    }
  }

  async function tick() {
    if (!state.running) return;

    const nowBusy = isBusy();
    if (nowBusy) seenBusy = true;

    if (lastBusy && !nowBusy && seenBusy) {
      seenBusy = false;
      if (state.sent >= state.limit) {
        return stop('최대 전송 횟수까지 작업 완료');
      }
      await setStatus(`응답 완료 감지, 다음 전송 준비 (${state.sent}/${state.limit})`);
      setTimeout(() => {
        if (state.running && !isBusy()) send();
      }, 1200);
    }

    lastBusy = nowBusy;
  }

  new MutationObserver(() => void tick()).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label', 'aria-disabled', 'disabled', 'data-testid']
  });

  setInterval(() => void tick(), 1000);

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.action === 'stop') {
      void stop('사용자 요청');
      reply({ message: '중지 요청 처리됨' });
      return;
    }

    if (message.action === 'start') {
      state = { running: true, sent: 0, limit: message.limit, prompt: message.prompt };
      lastBusy = isBusy();
      seenBusy = lastBusy;
      void setStatus(lastBusy ? '현재 응답 완료 대기 중' : '첫 프롬프트 전송 준비');
      reply({ message: lastBusy ? '현재 응답 완료를 기다립니다' : '첫 프롬프트 전송을 시작합니다' });
      if (!lastBusy) setTimeout(() => void send(), 300);
    }
  });
})();
