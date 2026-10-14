// 툴바 아이콘을 누르면 팝업 대신 사이드 패널을 연다.
// 사이드 패널은 페이지의 다른 곳을 클릭해도 닫히지 않는다.
// 서비스 워커가 깨어날 때마다 설정해 두면 설치·업데이트·재시작 경로와 무관하게 적용된다.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[AutoPilot] side panel 설정 실패', error));
