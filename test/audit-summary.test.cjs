'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('MCP/브라우저 JSONL 요약에서 도구 실패와 회차 수를 계산한다',async()=>{
  const {summarize,parseJsonl}=await import('../scripts/audit-summary.mjs');
  const rows=[
    {event:'turn_sent',runId:'run-123',time:'t1',turn:18},
    {event:'tool_result',runId:'run-123',timestamp:'t2',toolName:'exec_command',exitCode:1,toolError:true},
    {event:'mcp_request',status:200,outcome:'completed',toolName:'exec_command'},
    {event:'turn_result',runId:'run-123',status:'CONTINUE',turn:18}
  ];
  const result=summarize(parseJsonl(rows.map(x=>JSON.stringify(x)).join('\n')));
  assert.equal(result.runs['run-123'].turnsSent,1);
  assert.equal(result.runs['run-123'].failures,1);
  assert.equal(result.tools.exec_command.failed,1);
  assert.equal(result.requests.total,1);
  assert.throws(()=>parseJsonl('{invalid}'));
});
