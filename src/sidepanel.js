const $ = (selector) => document.querySelector(selector);

const els = {
  badge: $('#badge'),
  status: $('#status'),
  bar: $('#progress-bar'),
  counter: $('#counter'),
  prompt: $('#prompt'),
  limit: $('#limit'),
  strict: $('#strict'),
  start: $('#start'),
  stop: $('#stop'),
  reset: $('#reset'),
  log: $('#log'),
  clearLog: $('#clear-log')
};

const PHASE_LABEL = {
  idle: '대기',
  running: '실행 중',
  done: '완료',
  blocked: '확인 필요',
  error: '오류',
  stopped: '중지됨'
};

els.limit.max = String(AUTOPILOT_MAX_LIMIT);

// ---------- 설정 저장/복원 ----------

async function loadSettings() {
  const data = await chrome.storage.local.get(['settingPrompt', 'settingLimit', 'settingStrict']);
  els.prompt.value = data.settingPrompt ?? AUTOPILOT_DEFAULT_PROMPT;
  els.limit.value = String(data.settingLimit ?? AUTOPILOT_DEFAULT_LIMIT);
  els.strict.checked = data.settingStrict ?? true;
}

function saveSettings() {
  const limit = Number(els.limit.value);
  void chrome.storage.local.set({
    settingPrompt: els.prompt.value,
    settingLimit: Number.isInteger(limit) ? limit : AUTOPILOT_DEFAULT_LIMIT,
    settingStrict: els.strict.checked
  });
}

els.prompt.addEventListener('input', saveSettings);
els.limit.addEventListener('input', saveSettings);
els.strict.addEventListener('change', saveSettings);
els.reset.addEventListener('click', () => {
  els.prompt.value = AUTOPILOT_DEFAULT_PROMPT;
  saveSettings();
});

// ---------- 실행 상태 표시 ----------

function renderLog(entries) {
  els.log.replaceChildren();
  if (!entries?.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 기록이 없습니다';
    els.log.append(li);
    return;
  }
  for (const entry of [...entries].reverse()) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    const d = new Date(entry.t);
    time.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    const text = document.createElement('span');
    text.textContent = entry.m;
    li.append(time, text);
    els.log.append(li);
  }
}

function renderStatus(data) {
  const phase = data.autopilotPhase ?? 'idle';
  const sent = data.autopilotSent ?? 0;
  const limit = data.autopilotRunLimit ?? 0;
  const running = Boolean(data.autopilotRunning);

  els.badge.dataset.state = phase;
  els.badge.textContent = PHASE_LABEL[phase] ?? phase;
  els.status.textContent = data.autopilotStatus ?? '대기 중';
  els.counter.textContent = `${sent} / ${limit}회 전송`;
  els.bar.style.width = limit ? `${Math.min(100, (sent / limit) * 100)}%` : '0';

  els.start.disabled = running;
  els.stop.disabled = !running;
  els.prompt.disabled = running;
  els.limit.disabled = running;
  els.strict.disabled = running;

  renderLog(data.autopilotLog);
}

const STATUS_KEYS = ['autopilotStatus', 'autopilotPhase', 'autopilotSent', 'autopilotRunLimit', 'autopilotRunning', 'autopilotLog'];

async function refreshStatus() {
  try {
    renderStatus(await chrome.storage.local.get(STATUS_KEYS));
  } catch {}
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STATUS_KEYS.some((key) => key in changes)) void refreshStatus();
});

els.clearLog.addEventListener('click', () => void chrome.storage.local.set({ autopilotLog: [] }));

// ---------- 시작/중지 ----------

function showLocalError(message) {
  els.badge.dataset.state = 'error';
  els.badge.textContent = PHASE_LABEL.error;
  els.status.textContent = message;
}

async function activeChatGPTTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith('https://chatgpt.com/') ? tab : null;
}

async function act(action) {
  const tab = await activeChatGPTTab();
  if (!tab) return showLocalError('ChatGPT 대화 탭을 활성화한 뒤 다시 누르세요');

  const prompt = els.prompt.value.trim();
  const limit = Number(els.limit.value);

  if (action === 'start') {
    if (!prompt) return showLocalError('후속 프롬프트가 비어 있습니다');
    if (!Number.isInteger(limit) || limit < 1 || limit > AUTOPILOT_MAX_LIMIT) {
      return showLocalError(`최대 전송 횟수는 1~${AUTOPILOT_MAX_LIMIT} 사이 정수여야 합니다`);
    }
  }

  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      action,
      prompt,
      limit,
      strict: els.strict.checked
    });
    if (result?.message) els.status.textContent = result.message;
  } catch {
    showLocalError('ChatGPT 탭을 새로고침한 뒤 다시 시도하세요');
  }
}

els.start.addEventListener('click', () => void act('start'));
els.stop.addEventListener('click', () => void act('stop'));

void loadSettings();
void refreshStatus();
