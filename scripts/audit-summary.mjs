/* 사용법: node scripts/audit-summary.mjs <events.jsonl> [summary.json] */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function summarize(events) {
  const runs = {};
  const tools = {};
  const requests = {total:0,failedHttp:0,aborted:0};
  let eventsRead=0;
  for(const x of events) {
    if(!x || typeof x!=='object')continue;
    eventsRead++;
    const name=typeof x.toolName==='string'?x.toolName:'unknown';
    if(x.event==='mcp_request'){
      requests.total++;
      if(x.status>=400)requests.failedHttp++;
      if(x.outcome==='aborted')requests.aborted++;
    }
    if(x.event==='tool_result'){
      if(!tools[name])tools[name]={calls:0,failed:0,exitCodes:{}};
      tools[name].calls++;
      if(x.toolError)tools[name].failed++;
      if(Number.isInteger(x.exitCode)) {
        const key=String(x.exitCode);
        tools[name].exitCodes[key]=(tools[name].exitCodes[key]||0)+1;
      }
    }
    if(x.runId){
      const id=x.runId;
      if(!runs[id])runs[id]={events:0,firstSeen:null,lastSeen:null,turnsSent:0,turnsFinished:0,failures:0,tools:[]};
      const r=runs[id];
      r.events++;r.firstSeen??=x.timestamp||x.time||null;
      r.lastSeen=x.timestamp||x.time||r.lastSeen;
      if(x.event==='turn_sent')r.turnsSent++;
      if(x.event==='turn_result')r.turnsFinished++;
      if(x.toolError||x.status==='blocked'||x.status==='error')r.failures++;
      if(x.event==='tool_result' && !r.tools.includes(name))r.tools.push(name);
    }
  }
  return {generatedAt:new Date().toISOString(),eventsRead,requests,tools,runs};
}
export function parseJsonl(raw) {
  const lines=String(raw).split(/\r?\n/).filter(x=>x.trim());
  return lines.map((line,i)=>{
    try{return JSON.parse(line);}
    catch{throw Error('JSONL '+(i+1)+'번째 줄 파싱 오류');}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [, ,input,output] = process.argv;
  if(!input){console.error('사용법: node scripts/audit-summary.mjs <events.jsonl> [summary.json]');process.exitCode=1;}
  else{
    try{
      const data=summarize(parseJsonl(await readFile(input,'utf8')));
      const json=JSON.stringify(data,null,2)+'\n';
      if(output){await writeFile(output,json,{mode:0o600});console.log('요약 파일:',output);}
      else console.log(json);
    }catch(error){console.error(error.message);process.exitCode=1;}
  }
}
