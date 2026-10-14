# 아키텍처

- `manifest.json`: Chrome MV3 설정 및 ChatGPT 도메인 한정
- `popup.html`, `src/popup.js`: 사용자 설정과 시작·중지
- `src/content.js`: ChatGPT DOM 관찰과 후속 프롬프트 전송
- 사용자 승인 없이 자동으로 시작하거나 페이지 새로고침 후 자동 재개하지 않음
