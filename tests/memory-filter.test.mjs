import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {removeManagedFactBlocks,guardMemoryInstruction,isChannelSession} from '../memory-filter.js';
const memoryId='a'.repeat(64);
const content='手写的项目规则\n\n<!-- dsh-memory:'+memoryId+' -->\n- 仅主人私聊可召回的已发布事实\n<!-- /dsh-memory:'+memoryId+' -->\n\n手写的其他内容';
test('local instructions retain manual prose while managed facts are delegated to Memory',()=>{
 const ctx={get:name=>name==='memoryDreaming'?{configFile:{value:{enabled:true,recall:true}}}:null};
 const result=guardMemoryInstruction(ctx,{id:'desktop',header:{origin:'desktop'}},'MEMORY.md',content);
 assert(result.includes('手写的项目规则'));assert(result.includes('手写的其他内容'));assert(!result.includes('已发布事实'));
 assert.equal(guardMemoryInstruction(ctx,{id:'desktop',header:{}},'AGENTS.md',content),content);
});
test('only verified owner private channel can inherit manual memory instructions',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-memory-instructions-'));
 fs.mkdirSync(path.join(dir,'channel-core'));
 const db=new DatabaseSync(path.join(dir,'channel-core','state.sqlite'));
 db.exec('CREATE TABLE bindings(session_id TEXT);CREATE TABLE receipts(session_id TEXT)');
 db.prepare('INSERT INTO bindings VALUES(?)').run('dm-owner');db.prepare('INSERT INTO bindings VALUES(?)').run('dm-other');
 db.close();
 try{
  const memory={configFile:{value:{enabled:true,recall:true,ownerIdentityId:'owner'}}};
  const core={trustedMemorySession:(id,owner)=>id==='dm-owner'&&owner==='owner'};
  const ctx={get:name=>name==='memoryDreaming'?memory:name==='channelCore'?core:null,dshHomePath:(...p)=>path.join(dir,...p)};
  const owner=guardMemoryInstruction(ctx,{id:'dm-owner',header:{}},'MEMORY.md',content);
  assert(owner.includes('手写的项目规则'));assert(!owner.includes('已发布事实'));
  assert.equal(guardMemoryInstruction(ctx,{id:'dm-other',header:{}},'MEMORY.md',content),'');
  assert.equal(guardMemoryInstruction(ctx,{id:'unlinked',header:{origin:'discord'}},'MEMORY.md',content),'');
  assert.equal(guardMemoryInstruction(ctx,{id:'dm-owner',header:{origin:'discord'}},'MEMORY.md',content),owner);
  memory.configFile.value.ownerIdentityId='';
  assert.equal(guardMemoryInstruction(ctx,{id:'dm-owner',header:{}},'MEMORY.md',content),'');
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('broken managed block never leaks the rest of a private fact',()=>{
 assert.equal(removeManagedFactBlocks('公共文字\n<!-- dsh-memory:'+memoryId+' -->\nsecret without end'),'公共文字');
});
