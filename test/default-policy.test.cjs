'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {TextEncoder}=require('node:util');

const code=fs.readFileSync(require.resolve('../src/defaults.js'),'utf8');
const defaults=vm.runInNewContext(code+'; AUTOPILOT_DEFAULT_PROMPT');
const content=fs.readFileSync(require.resolve('../src/content.js'),'utf8');

test('기본 프롬프트: 허용된 로컬 작업과 설정은 별도 허락 없이 실행',()=>{
  assert.match(defaults,/현재.*허용된.*직접 진행/);
  assert.match(defaults,/로컬 커밋/);
  assert.match(defaults,/권한을.*스스로.*허용|허용된.*설정/);
});
test('기본 프롬프트: 실제 외부 승인/권한 없고 대안이 없을 때만 BLOCKED',()=>{
  assert.match(defaults,/실제.*권한.*승인/);
  assert.match(defaults,/독립.*작업.*없/);
  assert.match(defaults,/AUTOPILOT: BLOCKED/);
});
test('모든 회차의 고정 규칙: 할 수 있는 일은 무확인 진행, 실제 장벽만 보고',()=>{
  assert.match(content,/이미 허용된.*직접.*진행/);
  assert.match(content,/BLOCKED.*실제.*권한.*승인/);
  assert.match(content,/보안 제한 우회/);
  assert.match(content,/원격 push.*실제 배포/);
});

test('이전 기본 프롬프트만 자동 갱신하고 수정한 사용자 프롬프트는 유지',async()=>{
  const source=fs.readFileSync(require.resolve('../src/sidepanel.js'),'utf8');
  const start=source.indexOf('const LEGACY_DEFAULT_SHA256 =');
  const end=source.indexOf('\nasync function loadSettings()',start);
  assert.ok(start>=0 && end>start);
  const check=vm.runInNewContext(source.slice(start,end)+'\nisUneditedLegacyDefault',{crypto:webcrypto,TextEncoder,Uint8Array});
  const legacy=fs.readFileSync(require.resolve('./fixtures/v041-default-prompt.txt'),'utf8');
  assert.equal(await check(legacy),true);
  assert.equal(await check(legacy+' '),false);
  assert.equal(await check(legacy.replace('한 단계','두 단계')),false);
  assert.equal(await check(defaults),false);
  assert.match(source,/if \(await isUneditedLegacyDefault\(prompt\)\)/);
  assert.match(source,/await chrome\.storage\.local\.set\(\{ settingPrompt: prompt \}\)/);
});
