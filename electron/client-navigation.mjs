import {validWorkId} from '../core/work.mjs';
export class ClientNavigation{
  constructor({openExternal,platform=process.platform}){this.openExternal=openExternal;this.platform=platform;this.pending=new Map();}
  open(id){
    if(!validWorkId(id))return Promise.reject(new Error('Invalid conversation.'));
    const key=id.toLowerCase();if(this.pending.has(key))return this.pending.get(key);
    // Let the client's URL handler handle foregrounding. Launch Services need
    // not separately activate the old view before the conversation URL arrives.
    const operation=Promise.resolve().then(()=>this.openExternal(`codex://threads/${key}`,this.platform==='darwin'?{activate:false}:undefined)).finally(()=>this.pending.delete(key));
    this.pending.set(key,operation);return operation;
  }
}
