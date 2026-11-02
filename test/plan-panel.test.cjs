'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../src/planning.js');
const P=require('../src/projects.js');

function setup({url,sendError,tabError,storageError}={}){
  const els={}, store={}, handlers={};
  const element=(id)=>({
    value:'',textContent:'',hidden:false,disabled:false,
    children:[],style:{},dataset:{},
    addEventListener(name,listener){(handlers[id]??={})[name]=listener;},
    append(...items){this.children.push(...items);},
    replaceChildren(){this.children=[];},
    dispatchEvent(){},
    querySelector(){return null;}
  });
  const ids=[
    'plan-project','plan-name','plan-scope','plan-save','plan-discover',
    'plan-discover-status','plan-analyze','plan-status','plan-summary',
    'plan-questions','plan-submit','plan-review','plan-result','plan-approve',
    'plan-start','scope','mode','prompt','start'
  ];
  ids.forEach(id=>els[id]=element(id));
  const document={
    querySelector(selector){return els[selector.replace(/^#/,'')] || null;},
    createElement(tag){return element(tag);}
  };
  let sendCount=0;
  const chrome={
    tabs:{
      async query(){if(tabError)throw Error(tabError);return [{id:29,...(url===undefined?{}:{url})}];},
      async sendMessage(id,message){
        sendCount++;
        assert.equal(id,29);
        assert.equal(message.action,'planDiscover');
        if(sendError)throw Error(sendError);
        return {message:'MCP 프로젝트 검색을 요청했습니다.'};
      }
    },
    storage:{
      local:{
        async get(keys){
          if(storageError)throw Error(storageError);
          return Object.fromEntries(keys.map(k=>[k,store[k]]));
        },
        async set(obj){
          if(storageError)throw Error(storageError);
          Object.assign(store,obj);
        }
      },
      onChanged:{addListener(){}}
    }
  };
  const ctx={
    window:{AutoPilotPlanning:D,AutoPilotProjects:P},
    document,chrome,
    crypto:{randomUUID:()=> 'unique-id'},
    Event:class {constructor(type){this.type=type;}},
    console
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/plan-panel.js'),'utf8'),ctx);
  return {els,handlers,store,get sendCount(){return sendCount;}};
}
async function tick(){await new Promise(resolve=>setTimeout(resolve,5));}

test('URL 메타데이터가 없는 ChatGPT 활성 탭에도 프로젝트 검색 요청을 보낸다',async()=>{
  const x=setup();
  await tick();
  assert.equal(x.els['plan-project'].value,'new');
  await x.handlers['plan-discover'].click();
  assert.equal(x.sendCount,1);
  assert.match(x.els['plan-discover-status'].textContent,/MCP 프로젝트 검색을 요청했습니다/);
});

test('현재 탭이 ChatGPT가 아니라면 전송하지 않고 버튼 아래에 오류 표시',async()=>{
  const x=setup({url:'https://example.org/'});
  await tick();
  await x.handlers['plan-discover'].click();
  assert.equal(x.sendCount,0);
  assert.match(x.els['plan-discover-status'].textContent,/ChatGPT 대화 탭을 활성화/);
});

test('확장 프로그램 콘텐츠 스크립트 연결 실패를 버튼 아래에서 안내',async()=>{
  const x=setup({sendError:'Could not establish connection. Receiving end does not exist.'});
  await tick();
  await x.handlers['plan-discover'].click();
  assert.equal(x.sendCount,1);
  assert.match(x.els['plan-discover-status'].textContent,/콘텐츠 스크립트 연결 실패/);
});

test('탭 조회 실패도 버튼 클릭 처리에서 보여준다',async()=>{
  const x=setup({tabError:'Tabs unavailable'});
  await tick();
  await x.handlers['plan-discover'].click();
  assert.match(x.els['plan-discover-status'].textContent,/Tabs unavailable/);
});

test('상태 저장 실패를 처리하고 사용자에게 오류를 표시한다',async()=>{
  const x=setup({storageError:'Quota exceeded'});
  await tick();
  await x.handlers['plan-discover'].click();
  assert.match(x.els['plan-discover-status'].textContent,/Quota exceeded/);
});

test('검색 버튼 상태 메시지는 화면 상단에 바로 존재한다',()=>{
  const html=fs.readFileSync(require.resolve('../sidepanel.html'),'utf8');
  const start=html.indexOf('id="plan-discover"');
  const status=html.indexOf('id="plan-discover-status"');
  const name=html.indexOf('id="plan-name"');
  assert.ok(start>=0 && status>start && name>status);
});
