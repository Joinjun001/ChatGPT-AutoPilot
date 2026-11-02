/* 프로젝트 프로필과 Claude 방식의 단계별 설계 인터뷰 UI. */
(() => {
  const D=window.AutoPilotPlanning;
  if (!D) throw Error('planning.js 누락');
  const $=s=>document.querySelector(s);
  const ui={
    project:$('#plan-project'),name:$('#plan-name'),scope:$('#plan-scope'),
    save:$('#plan-save'),analyze:$('#plan-analyze'),status:$('#plan-status'),
    summary:$('#plan-summary'),questions:$('#plan-questions'),
    submit:$('#plan-submit'),review:$('#plan-review'),result:$('#plan-result'),
    approve:$('#plan-approve'),start:$('#plan-start')
  };
  const defaults=[
    {id:'salvager',name:'Project Salvager',scope:'/shared/project-salvager',approvedPlan:null},
    {id:'perpdex',name:'PerpDEX',scope:'/shared/PerpDEX',approvedPlan:null}
  ];
  let profiles=[], selectedId='', planData=null, planQuestions=null, questionSignature='', pending=false;
  const current=()=>profiles.find(x=>x.id===selectedId) || null;
  const renderMessage=message=>{ui.status.textContent=message;};
  async function persist() {
    await chrome.storage.local.set({autopilotProfiles:profiles,autopilotSelectedProject:selectedId});
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
    renderMessage(item?.approvedPlan ? '확정된 계획이 저장되어 있습니다.' : 'AI 분석을 진행하면 개발 목표를 추천합니다.');
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
    renderMessage('프로젝트 설정을 저장했습니다.');
  }
  function showQuestions(value) {
    const signature=JSON.stringify(value);
    if (signature===questionSignature) return;
    questionSignature=signature;
    planQuestions=value;
    ui.questions.replaceChildren();
    ui.summary.textContent=value.summary;
    value.questions.forEach((q,i)=>{
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
        if(j===0) input.checked=true;
        label.append(input,document.createTextNode((j+1)+'. '+option));
        block.append(label);
      });
      const custom=document.createElement('label');
      custom.className='check';
      const customRadio=document.createElement('input');
      customRadio.type='radio';customRadio.name='plan-q'+i;customRadio.value='custom';
      custom.append(customRadio,document.createTextNode('직접 입력'));
      block.append(custom);
      const input=document.createElement('textarea');
      input.rows=2;input.placeholder='원하는 방향 직접 입력 (선택 시 필수)';
      input.style.minHeight='56px';
      input.dataset.questionIndex=String(i);
      input.addEventListener('input',()=>{if(input.value.trim()) customRadio.checked=true;});
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
    return tab?.url?.startsWith('https://chatgpt.com/') ? tab:null;
  }
  async function send(action,params) {
    if(pending)return;
    const tab=await activeTab();
    if(!tab){renderMessage('ChatGPT 대화 탭을 활성화하고 플러그인을 연결하세요.');return;}
    pending=true;ui.analyze.disabled=true;ui.submit.disabled=true;
    try {
      const result=await chrome.tabs.sendMessage(tab.id,{action,...params});
      renderMessage(result?.message||'요청 전달 완료');
    } catch(error) {
      renderMessage('ChatGPT 탭을 새로고침한 뒤 다시 실행하세요.');
    } finally {
      pending=false;ui.analyze.disabled=false;ui.submit.disabled=false;
    }
  }
  async function refreshPlanStorage() {
    const data=await chrome.storage.local.get(['autopilotPlanQuestions','autopilotPlanResult','autopilotPlanScope','autopilotPlanPhase','autopilotPlanStatus']);
    if(!current() || data.autopilotPlanScope!==current().scope) return;
    if(data.autopilotPlanStatus) renderMessage(data.autopilotPlanStatus);
    if(data.autopilotPlanPhase==='questions' && data.autopilotPlanQuestions) showQuestions(data.autopilotPlanQuestions);
    if(data.autopilotPlanPhase==='review' && data.autopilotPlanResult) {
      showPlan(data.autopilotPlanResult);
      ui.submit.hidden=true;
    }
  }
  ui.project.addEventListener('change',()=>{choose(ui.project.value);void refreshPlanStorage();});
  ui.save.addEventListener('click',()=>void saveProject());
  ui.analyze.addEventListener('click',async()=>{
    const item=current();
    if(!item){renderMessage('프로젝트를 먼저 저장하세요.');return;}
    item.approvedPlan=null;
    await persist();
    questionSignature='';planQuestions=null;planData=null;
    ui.questions.replaceChildren();ui.summary.textContent='';ui.submit.hidden=true;ui.review.hidden=true;
    await chrome.storage.local.set({autopilotPlanQuestions:null,autopilotPlanResult:null,autopilotPlanScope:item.scope});
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
    if(area==='local' && Object.keys(changes).some(x=>x.startsWith('autopilotPlan'))) void refreshPlanStorage();
  });
  void (async()=>{
    const s=await chrome.storage.local.get(['autopilotProfiles','autopilotSelectedProject','settingScope']);
    profiles=Array.isArray(s.autopilotProfiles)&&s.autopilotProfiles.length ? s.autopilotProfiles : defaults;
    selectedId=profiles.some(x=>x.id===s.autopilotSelectedProject) ? s.autopilotSelectedProject :
      (profiles.find(x=>x.scope===s.settingScope)?.id || profiles[0].id);
    refreshProjects();choose(selectedId);
    await refreshPlanStorage();
  })();
})();
