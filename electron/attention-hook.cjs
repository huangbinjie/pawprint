// Copied outside app.asar for the client's command-hook runner. This relay never
// returns an approval decision, model context, or a prompt on stdout.
const {createHash,randomUUID}=require('node:crypto');
const {mkdirSync,appendFileSync,statSync,renameSync}=require('node:fs');
const path=require('node:path');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const questionTool=name=>typeof name==='string'&&/(?:request_user_input(?:_async)?|AskUserQuestion)$/.test(name);
function ordered(value){if(Array.isArray(value))return value.map(ordered);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])]));return value;}
const hash=value=>createHash('sha256').update(value).digest('hex');
function decode(value){if(typeof value==='string'){try{return JSON.parse(value);}catch{return null;}}return value;}
function toolResponse(value){let v=decode(value);if(v?.content?.length===1&&v.content[0].type==='text')v=decode(v.content[0].text);return v;}
function requestKey(input,kind){
  if(kind==='question'&&typeof input.tool_use_id==='string')return hash(`question:${input.session_id}:${input.tool_use_id}`);
  return hash(`${kind}:${input.session_id}:${input.turn_id||''}:${input.tool_name||''}:${JSON.stringify(ordered(input.tool_input||{}))}`);
}
function normalizeHook(input,now=Date.now()){
  if(!input||!UUID.test(input.session_id||''))return null;
  const event=input.hook_event_name,name=input.tool_name;
  const base={version:1,eventId:randomUUID(),threadId:input.session_id.toLowerCase(),at:now};
  if(event==='PermissionRequest')return {...base,action:'waiting',kind:'approval',requestId:requestKey(input,'approval')};
  if(event==='PreToolUse'&&questionTool(name)&&!name.endsWith('_async'))return {...base,action:'waiting',kind:'question',requestId:requestKey(input,'question')};
  if(event==='PostToolUse'){
    if(questionTool(name)){
      const response=toolResponse(input.tool_response);
      if(name.endsWith('_async')){
        if(response?.accepted===true)return {...base,action:'waiting',kind:'question',requestId:requestKey(input,'question')};
        if(response?.accepted!==false&&!response?.error&&!response?.isError&&!response?.answers)return null;
      }
      return {...base,action:'resolved',kind:'question',requestId:requestKey(input,'question')};
    }
    return {...base,action:'resolved',kind:'approval',requestId:requestKey(input,'approval')};
  }
  if(['Stop','Interrupt','SessionEnd','UserPromptSubmit'].includes(event))return {...base,action:'clear',kind:null,requestId:null};
  return null;
}
async function relay(destination){
  let bytes=0,chunks=[];
  for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1024*1024)return;chunks.push(chunk);}
  const event=normalizeHook(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(!event)return;
  mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
  try{if(statSync(destination).size>1024*1024)renameSync(destination,destination+'.previous');}catch{}
  appendFileSync(destination,JSON.stringify(event)+'\n',{mode:0o600});
}
module.exports={normalizeHook,requestKey,questionTool};
if(require.main===module){const destination=process.argv[2];if(typeof destination==='string'&&path.isAbsolute(destination))relay(destination).catch(()=>{});}
