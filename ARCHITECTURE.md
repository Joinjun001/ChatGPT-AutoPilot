# 아키텍처 (v0.4.0)

## 구성

- `sidepanel.html`, `src/sidepanel.js`: 최초 작업 지시, 모드, 고정 작업 범위, 횟수, UI 재확인, 재개, 다음 프롬프트 미리보기.
- `src/content.js`: 응답 종료 감시, 클릭 이전 UI 재확인, 메시지 전송, 체크포인트 관리, 상태 전이, 자동 중지.
- `src/protocol.js`: 순수 응답 파서, 구분자 검증, 회차별 식별자 및 프롬프트 구성. Node 단위 테스트 대상.
- `src/defaults.js`: 최초 프롬프트 기본값.
- `src/background.js`: 사용자가 툴바에서 사이드 패널 열기.

## 작업 상태 머신

`ready → sending → waiting → ready`를 반복합니다. `waiting`에서 완성된 응답만 평가합니다. `DONE`이면 `finished`, `BLOCKED` 또는 형식 오류면 중단합니다. 클릭 이전 DOM 실패만 재확인하고, 전송 여부 불명 단계인 `sending`에서는 재개를 금지합니다.

메시지마다 `[AUTOPILOT_MESSAGE_ID:<runId>:<turn>]`과 끝 식별자를 추가해 최신 응답만 읽습니다. 프롬프트 본문이 접혀 끝 식별자가 보이지 않으면 중복 전송하지 않고 중단합니다. 안전한 판독 실패는 작업이 멈추는 쪽으로 판정합니다.

`chrome.storage.local`의 `autopilotCheckpoint`에 runId, 대화 URL, sent/limit, mode, scope, prompt/nextPrompt, phase, 마지막 처리 회차를 저장합니다. 페이지 재진입 시 자동 재시작하지 않고 수동 재개를 지원합니다.

## 보안 경계

AI가 생성한 프롬프트와 웹 문서는 도구 권한을 바꿀 수 없습니다. 고정 프롬프트 지시는 실질적인 권한 강제가 아니므로, 반드시 연결된 도구 수준에서 허용 경로 및 위험 작업을 제한해야 합니다. 실제 배포·push·삭제·인증 우회는 자동 진행하지 않도록 설계했습니다.

## 검증

`npm run check`, `npm test`는 JS 구문 및 프로토콜을 검사합니다. 실제 브라우저 E2E와 장시간 자동화는 별도 검증이 필요합니다.
