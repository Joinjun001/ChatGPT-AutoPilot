/* 브라우저 기반 실행 추적. 프롬프트/도구 출력/자격증명을 영속 로그에 남기지 않는다. */
(function(root){
  'use strict';
  const KEY='autopilotAuditEvents';
  const MAX=1000;
  let queue=Promise.resolve();
  function clean(value,limit=160){
    return typeof value==='string'?value.replace(/[\r\n\x00-\x1f]/g,' ').slice(0,limit):undefined;
  }
  function sanitize(e){
    if (!e || typeof e!=='object') throw Error('이벤트 객체가 필요합니다.');
    const allowed=['runId','event','scope','phase','status','reason','mode','planId'];
    const x={time:new Date().toISOString()};
    for (const k of allowed) {
      const v=clean(e[k]);
      if (v) x[k]=v;
    }
    for (const k of ['turn','limit','durationMs','nextPromptLength']) {
      if(Number.isFinite(e[k]) && e[k]>=0) x[k]=Math.round(e[k]);
    }
    if(!x.event) throw Error('이벤트 이름이 필요합니다.');
    return x;
  }
  function record(chromeApi,e){
    const data=sanitize(e);
    queue=queue.catch(()=>undefined).then(async()=>{
      const v=await chromeApi.storage.local.get([KEY]);
      const events=Array.isArray(v[KEY])?v[KEY].slice(-MAX+1):[];
      events.push(data);
      await chromeApi.storage.local.set({[KEY]:events});
    });
    return queue;
  }
  function summary(events) {
    const rows=Array.isArray(events)?events:[];
    const results={};
    for(const row of rows){
      if(!row || !row.runId)continue;
      const key=row.runId;
      if(!results[key])results[key]={runId:key,scope:row.scope||'',started:null,lastSeen:null,turnsSent:0,turnsFinished:0,blocked:0,errors:0,completed:false};
      const r=results[key];
      r.lastSeen=row.time;
      if(!r.scope && row.scope)r.scope=row.scope;
      if(row.event==='run_start')r.started=row.time;
      if(row.event==='turn_sent')r.turnsSent++;
      if(row.event==='turn_result')r.turnsFinished++;
      if(row.event==='run_end'){
        if(row.status==='done')r.completed=true;
        if(row.status==='blocked')r.blocked++;
        if(row.status==='error')r.errors++;
      }
    }
    return Object.values(results).slice(-25);
  }
  function toJsonl(events) {
    return (Array.isArray(events)?events:[]).map(v=>JSON.stringify(v)).join('\n')+'\n';
  }
  const api={KEY,MAX,sanitize,record,toJsonl,summary};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.AutoPilotAudit=api;
})(typeof window!=='undefined'?window:null);
