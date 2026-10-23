import {CodexTitleClient,findCodexBinary} from './codex-provider-titles.mjs';

// Query the native API with the same configuration home. This helper reads
// metadata only; it neither creates a thread nor sends an inference request.
export async function readCodexModelList({directory,clientFactory=async()=>new CodexTitleClient({binary:await findCodexBinary(),directory})}){
  let client;
  try{
    client=await clientFactory();await client.connect();
    const models=new Set(),cursors=new Set();let cursor=null;
    for(let page=0;page<32;page++){
      const result=await client.request('model/list',{includeHidden:false,cursor,limit:100});
      if(!Array.isArray(result?.data))throw Error('Invalid model list');
      for(const model of result.data){
        if(typeof model?.model!=='string'||!model.model||model.model.length>160)throw Error('Invalid model identifier');
        if(model.hidden!==true)models.add(model.model);
      }
      const next=result.nextCursor;
      if(next==null)return {status:'available',models:[...models]};
      if(typeof next!=='string'||!next||cursors.has(next))throw Error('Invalid model cursor');
      cursors.add(next);cursor=next;
    }
    throw Error('Model list too large');
  }catch{return {status:'unavailable',models:[]};}
  finally{await client?.close().catch(()=>{});}
}

export function modelSelection(provider,list){
  if(list?.status!=='available')return 'unknown';
  return list.models.includes(provider.model)?'picker':'fixed';
}
