// 매번 똑같이 보내도 안전하도록 작성한 기본 후속 프롬프트.
// 대화 기억이 아니라 프로젝트 파일과 Git 상태를 기준으로 다음 할 일을 정하게 하고,
// 마지막 줄의 AUTOPILOT 마커로 확장 프로그램이 계속/중지를 판단한다.
const AUTOPILOT_DEFAULT_PROMPT = `[AutoPilot 반복 작업] 연결된 SSalMuk 프로젝트에서 다음 한 단계를 진행하세요. 이 메시지는 매번 똑같이 반복되므로, 이전 대화 내용이 아니라 프로젝트 파일과 Git 상태를 기준으로 판단하세요.

1. 상태 확인: git_status로 변경 사항을 보고, PROJECT_STATE.md · ROADMAP.md · tasks/ 아래 문서(SPEC, TODO, QA, RESULT)를 읽어 현재 진행 상황을 파악하세요. 커밋되지 않은 변경이 있으면 새 작업보다 그 변경을 먼저 마무리하세요.
2. 작업 선택: 아직 끝나지 않은 항목 중 가장 앞선 것 하나만 고르세요. 이 문서들이 없으면 프로젝트 구조를 살펴 ROADMAP.md와 PROJECT_STATE.md부터 작성하세요.
3. 구현·검증: 고른 항목을 구현하고 project_run_check로 test/build를 실행하세요. 실패하면 이번 단계 안에서 원인을 찾아 고치세요.
4. 기록·커밋: 검증을 통과하면 해당 TASK의 TODO·RESULT와 PROJECT_STATE.md를 갱신하고, 바뀐 파일만 git_commit_files로 커밋하세요.

응답의 맨 마지막 줄에는 아래 셋 중 하나만 그대로 적으세요.
AUTOPILOT: CONTINUE  (남은 작업이 있음)
AUTOPILOT: DONE  (ROADMAP의 모든 항목이 끝났고 test/build가 통과함)
AUTOPILOT: BLOCKED  (사람의 결정·권한·승인이 필요하거나 같은 오류가 반복됨. 바로 위에 이유를 적기)`;

const AUTOPILOT_DEFAULT_LIMIT = 10;
const AUTOPILOT_MAX_LIMIT = 100;
