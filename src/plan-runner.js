/* Plan Mode는 일반 반복 엔진과 독립적으로 한 번만 전송하고, 결과를 로컬 저장소에 기록한다. */
(() => {
  if (window.__autopilotPlanRunnerLoaded) return;
  window.__autopilotPlanRunnerLoaded = true;
  const D = window.AutoPilotPlanning;
  const A = window.AutoPilotAudit;
  const C = window.AutoPilotComposer;
  if (!D || !C) throw Error('planning.js 또는 composer-ui.js 누락');

  let active = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isBusy = () => Boolean(document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"]'));
  const status = async (phase, message, scope, kind='questions') => {
    void A?.record(chrome,{event:kind==='discover'?'project_discovery':'plan_state',scope,phase,status:phase}).catch(()=>undefined);
    if(kind==='discover'){
      await chrome.storage.local.set({autopilotDiscoverPhase:phase,autopilotDiscoverStatus:message});
    } else {
      await chrome.storage.local.set({autopilotPlanPhase:phase, autopilotPlanStatus:message,
        ...(scope ? {autopilotPlanScope:scope} : {})});
    }
  };
  const editor=()=>C.findEditor(document);
  const sendButton=(el)=>C.findSend(document,el);

  function responseAfter(id) {
    const main=document.querySelector('main') || document.body;
    const messages=Array.from(main.querySelectorAll('[data-message-author-role]'));
    if (messages.length) {
      let anchor=-1;
      for (let i=messages.length-1;i>=0;i--) {
        if (messages[i].getAttribute('data-message-author-role')==='user' &&
            (messages[i].innerText || messages[i].textContent || '').includes(id)) {anchor=i;break;}
      }
      if (anchor<0) return '';
      const rest=messages.slice(anchor+1);
      if (rest.some(node=>node.getAttribute('data-message-author-role')==='user')) return '';
      return rest.filter(node=>node.getAttribute('data-message-author-role')==='assistant')
        .map(node=> {
          const blocks=Array.from(node.querySelectorAll('.markdown'));
          return blocks.length ? blocks.map(x=>x.innerText || x.textContent || '').join('\n') :
            node.innerText || node.textContent || '';
        }).join('\n');
    }
    const text=main.innerText || main.textContent || '';
    const end=text.lastIndexOf(id+':END');
    return end>=0 ? text.slice(end+(id+':END').length) : '';
  }
  async function run(kind, scope, prompt) {
    if (active || window.__autopilotPlanningActive) return '이미 설계 분석이 진행 중입니다.';
    if (kind!=='discover' && !D.validScope(scope)) return '프로젝트 경로를 확인해 주세요.';
    // 브라우저 저장소 조회 전에 잠가 빠른 중복 클릭의 이중 전송을 방지한다.
    active=true;
    window.__autopilotPlanningActive=true;
    let saved;
    try {
      saved=await chrome.storage.local.get(['autopilotRunning']);
    } catch (error) {
      active=false;
      window.__autopilotPlanningActive=false;
      return '실행 상태 조회 실패: '+error.message;
    }
    if (saved.autopilotRunning || isBusy()) {
      await status('error','다른 응답 또는 AutoPilot이 실행 중입니다.',scope,kind);
      active=false;
      window.__autopilotPlanningActive=false;
      return '다른 응답 또는 AutoPilot이 실행 중입니다.';
    }
    const id='[AUTOPILOT_PLAN_ID:'+crypto.randomUUID()+']';
    void A?.record(chrome,{event:'plan_start',scope,planId:id}).catch(()=>undefined);
    const text=id+'\n'+prompt+'\n'+id+':END';
    const phase=kind==='discover'?'discovering':kind==='questions'?'analyzing':'finalizing';
    await status(phase,kind==='discover'?'MCP에서 프로젝트를 검색 중입니다.':'설계 '+(kind==='questions'?'질문 생성':'계획 작성')+' 진행 중',scope,kind);
    try {
      let button=null;
      let inputObserved=false;
      for (let i=0;i<4;i++) {
        const el=editor();
        if (el) {
          // UI가 텍스트 입력 후 리렌더링될 수 있으므로 새 에디터를 다시 조회한다.
          if(!C.containsPrompt(el,text)) C.fill(el,text,document);
          await pause(350);
          const current=editor();
          if (C.containsPrompt(current,text)) {
            inputObserved=true;
            // 최신 UI는 전송 버튼을 텍스트 입력 뒤에 비동기로 생성한다.
            for (let tick=0;tick<12;tick++) {
              const candidate=sendButton(current);
              if (C.enabled(candidate)) {button=candidate;break;}
              if (isBusy()) break;
              await pause(250);
            }
            if(button)break;
          }
        }
        await pause(450);
      }
      if (!button || isBusy()) {
        const d=C.diagnosis(document);
        const reason=!d.editorFound?'입력창 없음':
          !inputObserved?'프롬프트 입력 결과 확인 실패':
          !d.sendFound?'전송 버튼 없음':'전송 버튼 비활성';
        // 원문 프롬프트나 채팅 내용을 로깅하지 않는다.
        throw Error('ChatGPT 입력 UI 확인 실패 ('+reason+', '+d.editorKind+'). 새로고침 후 재시도하거나 확장프로그램 로그를 확인하세요.');
      }
      await status(phase,'요청 전송 직전. 중복 전송은 금지됩니다.',scope,kind);
      button.click();
      await status(phase,'AI 응답을 확인 중',scope,kind);
      const deadline=Date.now()+180000;
      let last='';let stableAt=Date.now();
      while (Date.now()<deadline) {
        const raw=responseAfter(id);
        if (raw!==last) {last=raw;stableAt=Date.now();}
        const out=D.parseReply(raw,kind);
        if (out.ready && Date.now()-stableAt>2500 && !isBusy()) {
          if (out.error) throw Error(out.error);
          if(kind==='discover'){
            await chrome.storage.local.set({autopilotDiscoveredProjects:out.value});
            await status('results',out.value.summary,scope,kind);
          }else{
            const values=kind==='questions'
              ? {autopilotPlanQuestions:out.value,autopilotPlanResult:null}
              : {autopilotPlanResult:out.value};
            await chrome.storage.local.set({...values,autopilotPlanScope:scope});
            void A?.record(chrome,{event:'plan_result',scope,planId:id,status:kind}).catch(()=>undefined);
            await status(kind==='questions'?'questions':'review','AI 응답을 확인했습니다. 사용자 선택을 기다립니다.',scope,kind);
          }
          return '계획 응답 완료';
        }
        await pause(600);
      }
      throw Error('계획 응답을 확인할 수 없습니다. 자동 재전송하지 않습니다.');
    } catch (error) {
      await status('error',error.message || String(error),scope,kind);
      return '계획 오류: '+(error.message || String(error));
    } finally {
      active=false;
      window.__autopilotPlanningActive=false;
    }
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply) => {
    if(message.action==='planDiscover'){
      void run('discover','',D.discoveryPrompt());
      reply({message:'MCP 프로젝트 검색을 요청했습니다.'});
    }else if (message.action==='planAnalyze') {
      if (!D.validScope(message.scope)) {reply({message:'프로젝트 경로가 유효하지 않습니다.'});return;}
      void run('questions',message.scope,D.analysisPrompt(message.scope));
      reply({message:'프로젝트 분석을 시작했습니다.'});
    } else if (message.action==='planFinalize') {
      let prompt;
      try {
        const checked=D.checkQuestions(message.questions);
        prompt=D.finalizePrompt(message.scope,checked.questions,message.answers,checked.summary);
      } catch (error) {reply({message:'설계 답변 오류: '+error.message});return;}
      void run('result',message.scope,prompt);
      reply({message:'설계 결과를 바탕으로 계획 작성을 시작했습니다.'});
    }
  });
})();
