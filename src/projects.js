/* 프로젝트 목록: 하드코딩 기본값 없이 사용자 저장값과 MCP 검색 결과를 결합한다. */
(function(root){
  'use strict';
  const D=typeof module!=='undefined' && module.exports ? require('./planning.js') : root.AutoPilotPlanning;
  // v0.5.0/0.6.0에서 자동으로 시드된 두 프로필만 마이그레이션에서 식별한다.
  // 사용자가 이름/경로를 수정했거나 승인한 계획이 있다면 보존한다.
  const LEGACY_SEEDS=[
    {id:'salvager',name:'Project Salvager',scope:'/shared/project-salvager'},
    {id:'perpdex',name:'PerpDEX',scope:'/shared/PerpDEX'}
  ];
  function normalize(raw) {
    if(!Array.isArray(raw))return [];
    const paths=new Set();
    return raw.filter(x=>{
      if(!x || typeof x!=='object'||!D.validScope(x.scope)||typeof x.name!=='string'||!x.name.trim())return false;
      if(paths.has(x.scope))return false;
      paths.add(x.scope);
      return true;
    }).map(x=>({...x,name:x.name.trim().slice(0,100)}));
  }
  function migrate(raw,migrated) {
    const profiles=normalize(raw);
    if(migrated)return {profiles,changed:false};
    const kept=profiles.filter(x=>!LEGACY_SEEDS.some(d=>
      x.id===d.id && x.name===d.name && x.scope===d.scope && !x.approvedPlan));
    return {profiles:kept,changed:true};
  }
  function mergeDiscovered(existing,discovered,makeId) {
    const profiles=normalize(existing);
    let added=0;
    for(const p of discovered.projects || []){
      if(!D.validScope(p.scope) || profiles.some(x=>x.scope===p.scope))continue;
      profiles.push({id:makeId(),name:p.name.slice(0,100),scope:p.scope,approvedPlan:null,source:'mcp'});
      added++;
    }
    return {profiles,added};
  }
  const api={normalize,migrate,mergeDiscovered};
  if(typeof module!=='undefined' && module.exports)module.exports=api;
  if(root)root.AutoPilotProjects=api;
})(typeof window!=='undefined'?window:null);
