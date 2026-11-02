/* Plan Mode는 일반 반복 엔진과 독립적으로 한 번만 전송하고, 결과를 로컬 저장소에 기록한다. */
(() => {
  if (window.__autopilotPlanRunnerLoaded) return;
  window.__autopilotPlanRunnerLoaded = true;
  const D = window.AutoPilotPlanning;
  const A = window.AutoPilotAudit;
  if (!D) throw Error('planning.js 누락');

  let active = false;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isBusy = () => Boolean(document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"]'));
  const status = async (phase, message, scope) => {
    void A?.record(chrome,{event:'plan_state',scope,phase,status:phase}).catch(()=>undefined);
    await chrome.storage.local.set({autopilotPlanPhase:phase, autopilotPlanStatus:message,
      ...(scope ? {autopilotPlanScope:scope} : {})});
  };
  const firstVisible = selectors => {
    for (const selector of selectors) {
      const el=document.querySelector(selector);
      if (el && el.getClientRects().length) return el;
    }
    return null;
  };
  function editor() {
    return firstVisible(['#prompt-textarea','[data-testid="prompt-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]', 'textarea#prompt-textarea']);
  }
  function sendButton() {
    return firstVisible(['button[data-testid="send-button"]','#composer-submit-button',
      'button[aria-label="Send prompt"]','button[aria-label="메시지 보내기"]']);
  }
  function fill(el, message) {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(el,message);
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:message}));
    } else {
      const selection=window.getSelection();
      const range=document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('delete',false,null);
      if (!document.execCommand('insertText',false,message)) el.textContent=message;
      el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:message}));
    }
  }
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
    if (!D.validScope(scope)) return '프로젝트 경로를 확인해 주세요.';
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
      await status('error','다른 응답 또는 AutoPilot이 실행 중입니다.',scope);
      active=false;
      window.__autopilotPlanningActive=false;
      return '다른 응답 또는 AutoPilot이 실행 중입니다.';
    }
    const id='[AUTOPILOT_PLAN_ID:'+crypto.randomUUID()+']';
    void A?.record(chrome,{event:'plan_start',scope,planId:id}).catch(()=>undefined);
    const text=id+'\n'+prompt+'\n'+id+':END';
    const phase=kind==='questions'?'analyzing':'finalizing';
    await status(phase,'설계 '+(kind==='questions'?'질문 생성':'계획 작성')+' 진행 중',scope);
    try {
      let button=null;
      for (let i=0;i<3;i++) {
        const el=editor();
        if (el) {
          fill(el,text);
          await pause(350);
          if ((el.value ?? el.innerText ?? el.textContent ?? '').includes(text)) {
            button=sendButton();
            if (button && !button.disabled) break;
          }
        }
        await pause(700);
      }
      if (!button || isBusy()) throw Error('ChatGPT 메시지 입력·전송 버튼을 확인할 수 없습니다.');
      await status(phase,'계획 요청 전송 직전. 중복 전송은 금지됩니다.',scope);
      button.click();
      await status(phase,'AI 응답을 확인 중',scope);
      const deadline=Date.now()+180000;
      let last='';let stableAt=Date.now();
      while (Date.now()<deadline) {
        const raw=responseAfter(id);
        if (raw!==last) {last=raw;stableAt=Date.now();}
        const out=D.parseReply(raw,kind);
        if (out.ready && Date.now()-stableAt>2500 && !isBusy()) {
          if (out.error) throw Error(out.error);
          const values=kind==='questions'
            ? {autopilotPlanQuestions:out.value,autopilotPlanResult:null}
            : {autopilotPlanResult:out.value};
          await chrome.storage.local.set({...values,autopilotPlanScope:scope});
          void A?.record(chrome,{event:'plan_result',scope,planId:id,status:kind}).catch(()=>undefined);
          await status(kind==='questions'?'questions':'review','AI 응답을 확인했습니다. 사용자 선택을 기다립니다.',scope);
          return '계획 응답 완료';
        }
        await pause(600);
      }
      throw Error('계획 응답을 확인할 수 없습니다. 자동 재전송하지 않습니다.');
    } catch (error) {
      await status('error',error.message || String(error),scope);
      return '계획 오류: '+(error.message || String(error));
    } finally {
      active=false;
      window.__autopilotPlanningActive=false;
    }
  }
  chrome.runtime.onMessage.addListener((message,_sender,reply) => {
    if (message.action==='planAnalyze') {
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
