# 아키텍처

## 구성 요소

- `manifest.json`: Chrome MV3 설정. 권한은 `activeTab`, `storage`, `sidePanel`, 호스트는 `chatgpt.com`으로 한정
- `src/background.js`: 툴바 아이콘 클릭 시 사이드 패널을 열도록 설정 (`openPanelOnActionClick`)
- `sidepanel.html`, `src/sidepanel.js`: 설정(프롬프트·횟수·엄격 모드) 저장, 시작·중지 명령, 상태·진행률·로그 표시
- `src/defaults.js`: 기본 후속 프롬프트와 횟수 상수
- `src/content.js`: ChatGPT DOM 관찰, 프롬프트 입력·전송, 응답 종료 감지, `AUTOPILOT:` 마커 판독

## 데이터 흐름

- 패널 → content script: `chrome.tabs.sendMessage({ action, prompt, limit, strict })`
- content script → 패널: `chrome.storage.local`의 `autopilot*` 키 갱신, 패널은 `storage.onChanged`로 즉시 반영
- 사용자 설정은 `setting*` 키로 저장

## 설계 원칙

- 실제 파일 작업은 SSalMuk MCP가 담당하고, 확장 프로그램은 ChatGPT 화면 조작만 한다
- 사용자 승인 없이 자동으로 시작하거나 새로고침 후 자동 재개하지 않는다
- 응답에 명시적인 `AUTOPILOT: CONTINUE`가 있을 때만 계속하는 것을 기본으로 한다 (엄격 모드)
