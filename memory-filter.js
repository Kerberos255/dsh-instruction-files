import path from 'node:path';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

/** Never duplicate managed memory blocks in generic workspace instructions. */
export function removeManagedFactBlocks(source){
  const text=String(source),start=/<!-- dsh-memory:([a-f0-9]{32,128}) -->/g;
  let output='',cursor=0;
  while(true){
    start.lastIndex=cursor;
    const match=start.exec(text);
    if(!match){output+=text.slice(cursor);break;}
    output+=text.slice(cursor,match.index);
    const close='<!-- /dsh-memory:'+match[1]+' -->',end=text.indexOf(close,start.lastIndex);
    if(end<0)break;
    cursor=end+close.length;
  }
  return output.replace(/\n{3,}/g,'\n\n').trim();
}
export function isChannelSession(ctx,session){
  const sessionId=session?.id??session?.header?.id;
  if(!sessionId)return true;
  if(['channel','discord','feishu'].includes(session.header?.origin))return true;
  const core=ctx.get?.('channelCore');
  let db,owned=false;
  try{
    db=core?.store?.db;
    if(!db){
      const filename=ctx.dshHomePath?.('channel-core','state.sqlite');
      if(!filename||!fs.existsSync(filename))return false;
      db=new DatabaseSync(filename,{readOnly:true});owned=true;
    }
    return Boolean(db.prepare('SELECT 1 FROM bindings WHERE session_id=? LIMIT 1').get(sessionId)
      ||db.prepare('SELECT 1 FROM receipts WHERE session_id=? LIMIT 1').get(sessionId));
  }catch{ return true; }
  finally{if(owned)db?.close();}
}
export function guardMemoryInstruction(ctx,session,filename,content){
  if(path.win32.basename(String(filename??'')).toLowerCase()!=='memory.md' && path.posix.basename(String(filename??'')).toLowerCase()!=='memory.md')return content;
  // Shared channel workspaces must not inherit private personal memories.
  if(isChannelSession(ctx,session)){
    const memory=ctx.get?.('memoryDreaming'),config=memory?.configFile?.value;
    if(!config?.ownerIdentityId||!ctx.get?.('channelCore')?.trustedMemorySession?.(session.id??session.header?.id,config.ownerIdentityId))return '';
  }
  const service=ctx.get?.('memoryDreaming');
  if(service?.configFile?.value?.enabled&&service.configFile.value.recall)
    return removeManagedFactBlocks(content);
  return content;
}
