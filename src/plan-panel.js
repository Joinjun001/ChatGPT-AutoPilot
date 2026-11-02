/* 프로젝트 프로필과 Claude 방식의 단계별 설계 인터뷰 UI. */
(() => {
  const D=window.AutoPilotPlanning;
  const PM=window.AutoPilotProjects;
  if(!PM)throw Error('projects.js 누락');
  if (!D) throw Error('planning.js 누락');
  const $=s=>document.querySelector(s);
  const ui={
    project:$('#plan-project'),name:$('#plan-name'),scope:$('#plan-scope'),
    save:$('#plan-save'),discover:$('#plan-discover'),discoverStatus:$('#plan-discover-status'),
    analyze:$('#plan-analyze'),status:$('#plan-status'),
    summary:$('#plan-summary'),questions:$('#plan-questions'),
    submit:$('#plan-submit'),review:$('#plan-review'),result:$('#plan-result'),
    approve:$('#plan-approve'),start:$('#plan-start')
  };
  let profiles=[], selectedId='new', planData=null, planQuestions=null, questionSignature='', discoverySignature='', pending=false;
  const current=()=>profiles.find(x=>x.id===selectedId) || null;
  // 설계 초안은 프로젝트 경로별 키로 저장한다. 기존 전역 키는 구버전 마이그레이션에만 사용한다.
  const planKey=(scope,field)=>'autopilotPlan'+field+':'+scope;
  const renderMessage=message=>{ui.status.textContent=message;};
  const renderDiscoveryMessage=message=>{
    ui.discoverStatus.textContent=message;
    if(!planQuestions && !planData)renderMessage(message);
  };
  async function persist() {
    await chrome.storage.local.set({
      autopilotProfiles:profiles,autopilotSelectedProject:selectedId,autopilotProfilesMigrated:true
    });
  }
  function appendText(tag,value,parent) {
    const el=document.createElement(tag);
    el.textContent=value;
    parent.append(el);
    return el;
  }
  function refreshProjects() {
    ui.project.replaceChildren();
    profiles.forEach(x=>{
      const option=document.createElement('option');
      option.value=x.id;option.textContent=x.name;
      ui.project.append(option);
    });
    if(!profiles.length){
      const empty=document.createElement('option');
      empty.value='new';empty.textContent='프로젝트 검색 또는 직접 등록';
      ui.project.append(empty);ui.project.value='new';return;
    }
    const newOption=document.createElement('option');
    newOption.value='new';newOption.textContent='+ 새 프로젝트';
    ui.project.append(newOption);
    ui.project.value=selectedId || 'new';
  }
  function choose(id) {
    selectedId=id;
    ui.project.value=id;
    const item=current();
    ui.name.value=item?.name || '';
    ui.scope.value=item?.scope || '';
    if (item) {
      $('#scope').value=item.scope;
      $('#scope').dispatchEvent(new Event('input',{bubbles:true}));
    }
    planQuestions=null;planData=null;questionSignature='';
    ui.summary.textContent='';
    ui.questions.replaceChildren();
    ui.submit.hidden=true;
    ui.review.hidden=true;
    renderMessage(item?.approvedPlan ? '확정된 계획이 저장되어 있습니다.' :
      item ? 'AI 분석을 진행하면 개발 목표를 추천합니다.' : 'MCP에서 프로젝트를 찾거나 직접 등록하세요.');
    ui.start.disabled=!item?.approvedPlan;
    if (item?.approvedPlan) showPlan(item.approvedPlan);
    void persist();
  }
  async function saveProject() {
    const name=ui.name.value.trim().slice(0,100);
    const scope=ui.scope.value.trim();
    if (!name || !D.validScope(scope)) {
      renderMessage('이름과 /shared/ 하위 프로젝트 경로를 확인하세요.');return;
    }
    const existing=profiles.find(x=>x.scope===scope);
    if (existing && existing.id!==selectedId) {renderMessage('같은 경로의 프로젝트가 이미 있습니다.');return;}
    let item=current();
    if (item) {
      if (item.scope!==scope) item.approvedPlan=null;
      item.name=name;item.scope=scope;
    } else {
      item={id:crypto.randomUUID(),name,scope,approvedPlan:null};
      profiles.push(item);
    }
    refreshProjects();choose(item.id);
    await persist();
    await refreshPlanStorage();
    renderMessage('프로젝트 설정을 저장했습니다.');
  }
  function answerDraft() {
    return planQuestions?.questions.map((_,i)=>{
      const selected=ui.questions.querySelector('input[name="plan-q'+i+'"]:checked');
      const custom=ui.questions.querySelector('textarea[data-question-index="'+i+'"]');
      return {selected:selected?.value || '0',custom:custom?.value || ''};
    }) || [];
  }
  async function saveAnswers() {
    const scope=current()?.scope;
    if(!scope || !planQuestions)return;
    try {
      await chrome.storage.local.set({[planKey(scope,'Answers')]:answerDraft()});
    } catch(error) {
      renderMessage('질문 답변 저장 실패: '+(error?.message || String(error)));
    }
  }
  function showQuestions(value,savedAnswers) {
    const signature=JSON.stringify(value);
    if (signature===questionSignature) return;
    questionSignature=signature;
    planQuestions=value;
    ui.questions.replaceChildren();
    ui.summary.textContent=value.summary;
    value.questions.forEach((q,i)=>{
      const draft=Array.isArray(savedAnswers) ? savedAnswers[i] : null;
      const selected=['0','1','2','custom'].includes(draft?.selected) ? draft.selected : '0';
      const block=document.createElement('fieldset');
      block.style.cssText='border:1px solid var(--border);border-radius:8px;margin:12px 0;padding:10px';
      const legend=document.createElement('legend');
      legend.textContent=(i+1)+'. '+q.question;
      block.append(legend);
      q.options.forEach((option,j)=>{
        const label=document.createElement('label');
        label.className='check';
        const input=document.createElement('input');
        input.type='radio';input.name='plan-q'+i;input.value=String(j);
        input.checked=selected===String(j);
        input.addEventListener('change',()=>void saveAnswers());
        label.append(input,document.createTextNode((j+1)+'. '+option));
        block.append(label);
      });
      const custom=document.createElement('label');
      custom.className='check';
      const customRadio=document.createElement('input');
      customRadio.type='radio';customRadio.name='plan-q'+i;customRadio.value='custom';
      customRadio.checked=selected==='custom';
      customRadio.addEventListener('change',()=>void saveAnswers());
      custom.append(customRadio,document.createTextNode('직접 입력'));
      block.append(custom);
      const input=document.createElement('textarea');
      input.rows=2;input.placeholder='원하는 방향 직접 입력 (선택 시 필수)';
      input.style.minHeight='56px';input.maxLength=1500;
      input.dataset.questionIndex=String(i);
      input.value=typeof draft?.custom==='string' ? draft.custom.slice(0,1500) : '';
      input.addEventListener('input',()=>{
        if(input.value.trim()){
          customRadio.checked=true;
          block.querySelectorAll('input[name="plan-q'+i+'"]').forEach(radio=>{
            if(radio!==customRadio) radio.checked=false;
          });
        }
        void saveAnswers();
      });
      block.append(input);ui.questions.append(block);
    });
    ui.submit.hidden=false;
    ui.review.hidden=true;
  }
  function showPlan(value) {
    const p=D.checkPlan(value);
    planData=p;
    ui.review.hidden=false;
    ui.result.replaceChildren();
    appendText('strong',p.title,ui.result);
    appendText('p',p.goal,ui.result);
    appendText('strong','마일스톤',ui.result);
    const m=document.createElement('ol');
    p.milestones.forEach(x=>appendText('li',x,m));
    ui.result.append(m);
    appendText('strong','완료 기준',ui.result);
    const a=document.createElement('ol');
    p.acceptanceCriteria.forEach(x=>appendText('li',x,a));
    ui.result.append(a);
    if(p.constraints) appendText('p','제약: '+p.constraints,ui.result);
    ui.approve.disabled=false;
    ui.start.disabled=!current()?.approvedPlan;
    ui.start.textContent=current()?.approvedPlan ? '계획으로 실행' : '확정 후 실행 가능';
  }
  async function activeTab() {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!Number.isInteger(tab?.id))return null;
    // Chrome은 activeTab 권한 범위에 따라 tab.url을 제공하지 않을 수 있습니다.
    // URL이 없는 경우 현재 탭에만 메시지를 시도합니다.
    // 컨텐츠 스크립트는 chatgpt.com에만 등록되어 있으므로 다른 사이트에는 전달되지 않습니다.
    if(typeof tab.url==='string' && !/^https:\/\/chatgpt\.com(?:\/|$)/.test(tab.url))return null;
    return tab;
  }
  async function send(action,params) {
    if(pending){
      renderDiscoveryMessage('이미 요청 전송을 처리 중입니다.');
      return;
    }
    pending=true;ui.analyze.disabled=true;ui.discover.disabled=true;ui.submit.disabled=true;
    const isDiscovery=action==='planDiscover';
    const report=isDiscovery?renderDiscoveryMessage:renderMessage;
    const fail=async message=>{
      report(message);
      if(isDiscovery){
        try{
          await chrome.storage.local.set({
            autopilotDiscoverPhase:'error',autopilotDiscoverStatus:message
          });
        }catch{}
      }
    };
    try {
      report('ChatGPT 대화 탭 연결 확인 중...');
      const tab=await activeTab();
      if(!tab){await fail('ChatGPT 대화 탭을 활성화한 뒤 다시 눌러 주세요.');return;}
      report(isDiscovery?'ChatGPT 탭으로 프로젝트 검색 요청 전송 중...':'ChatGPT 탭으로 계획 요청 전송 중...');
      const result=await chrome.tabs.sendMessage(tab.id,{action,...params});
      if(!result){
        await fail('ChatGPT에서 요청 확인 응답이 없습니다. 탭을 새로고침해 주세요.');
        return;
      }
      report(result.message || 'ChatGPT에 요청을 전달했습니다. 응답 분석 중입니다.');
    }catch(error){
      const message=String(error?.message || error || '');
      if(/Receiving end does not exist|Could not establish connection/i.test(message)){
        await fail('ChatGPT 콘텐츠 스크립트 연결 실패: 확장프로그램과 ChatGPT 탭을 모두 새로고침해 주세요.');
      }else{
        await fail('연결 또는 요청 전송 오류: '+message.slice(0,180));
      }
    }finally{
      pending=false;ui.analyze.disabled=false;ui.discover.disabled=false;ui.submit.disabled=false;
    }
  }
  async function refreshPlanStorage() {
    const scope=current()?.scope;
    if(!scope)return;
    const keys=['Phase','Status','Questions','Result','Answers'].map(field=>planKey(scope,field));
    const data=await chrome.storage.local.get([...keys,
      'autopilotPlanQuestions','autopilotPlanResult','autopilotPlanScope',
      'autopilotPlanPhase','autopilotPlanStatus']);
    if(current()?.scope!==scope)return;
    // v0.6.3에서 저장된 질문/계획을 최초 접근 때만 해당 프로젝트로 가져온다.
    if(data[keys[0]]===undefined && data[keys[2]]===undefined &&
        data[keys[3]]===undefined && data.autopilotPlanScope===scope &&
        (data.autopilotPlanQuestions || data.autopilotPlanResult)){
      const migrated={
        [keys[0]]:data.autopilotPlanPhase,
        [keys[1]]:data.autopilotPlanStatus,
        [keys[2]]:data.autopilotPlanQuestions || null,
        [keys[3]]:data.autopilotPlanResult || null
      };
      await chrome.storage.local.set(migrated);
      Object.assign(data,migrated);
      if(current()?.scope!==scope)return;
    }
    if(data[keys[1]])renderMessage(data[keys[1]]);
    if(data[keys[3]]) {
      if(planData!==data[keys[3]])showPlan(data[keys[3]]);
      ui.questions.replaceChildren();
      planQuestions=null;questionSignature='';
      ui.submit.hidden=true;
    } else if(data[keys[2]]) {
      showQuestions(data[keys[2]],data[keys[4]]);
    }
  }
  async function refreshDiscovery() {
    const data=await chrome.storage.local.get([
      'autopilotDiscoverPhase','autopilotDiscoverStatus','autopilotDiscoveredProjects'
    ]);
    if(data.autopilotDiscoverPhase==='discovering'){
      renderDiscoveryMessage(data.autopilotDiscoverStatus||'MCP 프로젝트 검색 중입니다.');
      return;
    }
    if(data.autopilotDiscoverPhase==='error'){
      renderDiscoveryMessage('프로젝트 검색 오류: '+(data.autopilotDiscoverStatus||'응답을 확인할 수 없습니다.'));
      return;
    }
    if(data.autopilotDiscoverPhase!=='results'||!data.autopilotDiscoveredProjects)return;
    let checked;
    try{checked=D.checkDiscoveredProjects(data.autopilotDiscoveredProjects);}
    catch(error){renderMessage('검색 결과 검증 실패: '+error.message);return;}
    const signature=JSON.stringify(checked);
    if(signature===discoverySignature)return;
    discoverySignature=signature;
    const result=PM.mergeDiscovered(profiles,checked,()=>crypto.randomUUID());
    profiles=result.profiles;
    refreshProjects();
    // 기존 프로젝트는 재선택하지 않는다. choose()가 작성 중인 질문을 초기화하기 때문이다.
    if(!current() && profiles.length){
      choose(profiles[0].id);
      await refreshPlanStorage();
    }else{
      ui.project.value=selectedId;
    }
    await persist();
    renderDiscoveryMessage(checked.summary+' · 검색 '+checked.projects.length+'개, 신규 등록 '+result.added+'개');
  }
  ui.discover.addEventListener('click',async()=>{
    if(pending){
      renderDiscoveryMessage('이미 요청 전송을 처리 중입니다.');
      return;
    }
    discoverySignature='';
    renderDiscoveryMessage('MCP 프로젝트 검색을 준비 중입니다...');
    try{
      await chrome.storage.local.set({
        autopilotDiscoverPhase:'discovering',autopilotDiscoverStatus:'프로젝트 검색 요청 중',
        autopilotDiscoveredProjects:null
      });
      await send('planDiscover',{});
    }catch(error){
      renderDiscoveryMessage('검색 상태 저장 오류: '+String(error?.message || error).slice(0,180));
    }
  });
  ui.project.addEventListener('change',()=>{choose(ui.project.value);void refreshPlanStorage();});
  ui.save.addEventListener('click',()=>void saveProject());
  ui.analyze.addEventListener('click',async()=>{
    const item=current();
    if(!item){renderMessage('프로젝트를 먼저 저장하세요.');return;}
    item.approvedPlan=null;
    await persist();
    questionSignature='';planQuestions=null;planData=null;
    ui.questions.replaceChildren();ui.summary.textContent='';ui.submit.hidden=true;ui.review.hidden=true;
    await chrome.storage.local.set({
      autopilotPlanQuestions:null,autopilotPlanResult:null,autopilotPlanScope:item.scope,
      [planKey(item.scope,'Questions')]:null,[planKey(item.scope,'Result')]:null,
      [planKey(item.scope,'Answers')]:null,[planKey(item.scope,'Phase')]:'analyzing',
      [planKey(item.scope,'Status')]:'프로젝트 분석 요청 중'
    });
    await send('planAnalyze',{scope:item.scope});
  });
  ui.submit.addEventListener('click',async()=>{
    const item=current();
    if(!item || !planQuestions) return;
    const answers=[];
    for(let i=0;i<planQuestions.questions.length;i++){
      const checked=ui.questions.querySelector('input[name="plan-q'+i+'"]:checked');
      const box=ui.questions.querySelector('textarea[data-question-index="'+i+'"]');
      if(!checked){renderMessage('모든 질문에 응답해 주세요.');return;}
      const answer=checked.value==='custom' ? (box?.value || '').trim() : planQuestions.questions[i].options[Number(checked.value)];
      if(!answer){renderMessage('직접 입력 선택지에 내용을 적어 주세요.');return;}
      answers.push(answer);
    }
    await send('planFinalize',{scope:item.scope,questions:planQuestions,answers});
  });
  ui.approve.addEventListener('click',async()=>{
    const item=current();
    if(!item || !planData) return;
    item.approvedPlan=D.checkPlan(planData);
    await persist();
    const prompt=D.executionPrompt(item.scope,item.approvedPlan);
    $('#scope').value=item.scope;$('#prompt').value=prompt;$('#mode').value='dynamic';
    $('#scope').dispatchEvent(new Event('input',{bubbles:true}));
    $('#prompt').dispatchEvent(new Event('input',{bubbles:true}));
    $('#mode').dispatchEvent(new Event('change',{bubbles:true}));
    ui.start.disabled=false;ui.start.textContent='계획으로 실행';
    renderMessage('계획을 확정했습니다. 실행 횟수를 확인한 뒤 시작하세요.');
  });
  ui.start.addEventListener('click',()=>{
    const item=current();
    if(!item?.approvedPlan){renderMessage('계획을 먼저 확정해야 합니다.');return;}
    $('#scope').value=item.scope;
    $('#prompt').value=D.executionPrompt(item.scope,item.approvedPlan);
    $('#mode').value='dynamic';
    ['#scope','#prompt'].forEach(sel=>$(sel).dispatchEvent(new Event('input',{bubbles:true})));
    $('#mode').dispatchEvent(new Event('change',{bubbles:true}));
    $('#start').click();
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    const scope=current()?.scope;
    if(scope && ['Questions','Result','Phase','Status'].some(field=>planKey(scope,field) in changes))
      void refreshPlanStorage();
    if(Object.keys(changes).some(x=>x.startsWith('autopilotDiscover'))) void refreshDiscovery();
  });
  void (async()=>{
    try{
    const s=await chrome.storage.local.get([
      'autopilotProfiles','autopilotSelectedProject','settingScope','autopilotProfilesMigrated'
    ]);
    // 최초 업데이트 시에만 예전 자동 시드 프로필을 정리하고 사용자가 편집/승인한 항목은 보존한다.
    const migrated=PM.migrate(s.autopilotProfiles,s.autopilotProfilesMigrated);
    profiles=migrated.profiles;
    selectedId=profiles.some(x=>x.id===s.autopilotSelectedProject) ? s.autopilotSelectedProject :
      (profiles.find(x=>x.scope===s.settingScope)?.id || profiles[0]?.id || 'new');
    refreshProjects();choose(selectedId);
    await refreshPlanStorage();
    await refreshDiscovery();
    }catch(error){
      refreshProjects();
      renderDiscoveryMessage('프로젝트 설정 불러오기 실패: '+String(error?.message || error).slice(0,180));
    }
  })();
})();
