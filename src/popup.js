const statusEl = document.querySelector('#status');

async function activeChatGPTTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStatus() {
  try {
    const data = await chrome.storage.local.get(['autopilotStatus', 'autopilotSent', 'autopilotRunning']);
    if (data.autopilotStatus) {
      const sent = Number.isInteger(data.autopilotSent) ? ` · ${data.autopilotSent}회 전송` : '';
      statusEl.textContent = `${data.autopilotStatus}${sent}`;
    }
  } catch {}
}

async function act(action) {
  const tab = await activeChatGPTTab();
  if (!tab?.url?.startsWith('https://chatgpt.com/')) {
    statusEl.textContent = 'ChatGPT 탭을 선택하세요';
    return;
  }

  const prompt = document.querySelector('#prompt').value.trim();
  const limit = Number(document.querySelector('#limit').value);

  if (action === 'start' && (!prompt || !Number.isInteger(limit) || limit < 1 || limit > 30)) {
    statusEl.textContent = '설정 오류';
    return;
  }

  try {
    await chrome.storage.local.set({ autopilotStatus: action === 'start' ? '시작 요청 전송 중' : '중지 요청 전송 중' });
    const result = await chrome.tabs.sendMessage(tab.id, { action, prompt, limit });
    statusEl.textContent = result.message;
    setTimeout(refreshStatus, 400);
  } catch {
    statusEl.textContent = 'ChatGPT 탭을 새로고침하고 다시 시도하세요';
  }
}

document.querySelector('#start').onclick = () => act('start');
document.querySelector('#stop').onclick = () => act('stop');
refreshStatus();
setInterval(refreshStatus, 500);
