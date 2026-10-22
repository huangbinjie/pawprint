import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir,rename,rm,lstat} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {promisify} from 'node:util';
import {zstdDecompress,gunzip,inflate,brotliDecompress} from 'node:zlib';
import {parse} from 'smol-toml';
import {CodexRouteEvidence} from './codex-route-evidence.mjs';

const maxRequestBytes=32*1024*1024;
const decoders=new Map([['zstd',zstdDecompress],['gzip',gunzip],['deflate',inflate],['br',brotliDecompress]].map(([name,decode])=>[name,promisify(decode)]));

export async function hasFileChatGPTLogin(directory) {
  try {
    let settings={};try{settings=parse(await readFile(path.join(directory,'config.toml'),'utf8'));}catch(e){if(e.code!=='ENOENT')return false;}
    if(['keyring','ephemeral'].includes(settings.cli_auth_credentials_store))return false;
    const info=await lstat(path.join(directory,'auth.json'));
    if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)return false;
    const login=JSON.parse(await readFile(path.join(directory,'auth.json'),'utf8'));
    return (!login.auth_mode||login.auth_mode==='chatgpt')&&typeof login.tokens?.access_token==='string'&&typeof login.tokens?.id_token==='string';
  }catch{return false;}
}

// A loopback-only inference bridge separates ChatGPT identity from provider
// authentication. Incoming credentials/identity headers are never forwarded.
export class CodexIdentityBridge {
  constructor({dataDirectory,keychain,fetchImpl=fetch,onRoute=()=>{}}) {
    Object.assign(this,{dataDirectory,keychain,fetchImpl});this.file=path.join(dataDirectory,'codex-identity-bridge.json');this.providers=new Map();this.requests=new Set();
    this.routeEvidence=new CodexRouteEvidence(dataDirectory);this.onRoute=onRoute;
  }
  configure(providers){this.providers=new Map(providers.map(p=>[p.id,p]));}
  async start(){
    if(this.server?.listening)return;
    if(this.starting)return this.starting;
    this.starting=this.open().finally(()=>{this.starting=null;});return this.starting;
  }
  async open(){
    let saved;
    try{const info=await lstat(this.file);if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe bridge metadata');saved=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('本地连接服务配置无法读取，请检查 Pawprint 数据目录。');}
    if(saved&&(!Number.isInteger(saved.port)||saved.port<1024||saved.port>65535||!/^[a-f0-9]{64}$/.test(saved.capability)))throw Error('本地连接服务配置无效。');
    this.capability=saved?.capability||randomBytes(32).toString('hex');
    const server=http.createServer((req,res)=>void this.handle(req,res));
    server.requestTimeout=60000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
    server.on('clientError',(_,socket)=>socket.destroy());
    // The built-in OpenAI client probes WebSocket first. 426 explicitly asks
    // it to use HTTP Responses, which this bridge and existing providers use.
    server.on('upgrade',(_,socket)=>socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
    try {
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(saved?.port||0,'127.0.0.1',resolve);});
      this.server=server;this.port=server.address().port;
      await mkdir(this.dataDirectory,{recursive:true,mode:0o700});
      const tmp=this.file+'.'+randomUUID()+'.tmp';
      try{await writeFile(tmp,JSON.stringify({port:this.port,capability:this.capability}),{mode:0o600,flag:'wx'});await rename(tmp,this.file);}finally{await rm(tmp,{force:true});}
    }catch{server.close();this.server=null;throw Error('本地连接服务未能启动。请保持 Pawprint 运行，并检查端口是否被占用。');}
  }
  baseUrl(id){if(!this.server?.listening)throw Error('本地连接服务尚未启动。');return `http://127.0.0.1:${this.port}/${this.capability}/${id}/v1`;}
  error(res,status,message){if(res.headersSent){res.destroy();return;}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message,type:'pawprint_bridge_error'}}));}
  async handle(req,res){
    const match=/^\/([a-f0-9]{64})\/(pawprint_[a-f0-9]{32})\/v1\/(responses(?:\/compact)?)$/.exec(req.url||'');
    if(req.method!=='POST'||!match||match[1]!==this.capability||!this.providers.has(match[2])){this.error(res,404,'Not found');return;}
    // Browser-origin requests are not Codex. Never expose a local billing proxy to a website.
    if(req.headers.origin||req.headers['sec-fetch-site']){this.error(res,403,'Browser requests are not supported');return;}
    const encoding=(req.headers['content-encoding']||'identity').trim().toLowerCase();
    if(encoding!=='identity'&&!decoders.has(encoding)){this.error(res,415,'Unsupported request encoding');return;}
    const controller=new AbortController();this.requests.add(controller);
    const stop=()=>{if(!res.writableEnded)controller.abort();};req.on('aborted',stop);res.on('close',stop);
    const timeout=setTimeout(()=>controller.abort(),120000);
    try {
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>maxRequestBytes){this.error(res,413,'Request too large');return;}chunks.push(chunk);}
      let body=Buffer.concat(chunks);
      // Native ChatGPT-authenticated clients send Zstd-compressed JSON. Decode
      // locally; the provider receives plain JSON without identity headers.
      if(encoding!=='identity'){
        try{body=await decoders.get(encoding)(body,{maxOutputLength:maxRequestBytes});}
        catch(e){this.error(res,e.code==='ERR_BUFFER_TOO_LARGE'?413:400,e.code==='ERR_BUFFER_TOO_LARGE'?'Request too large':'Invalid compressed request');return;}
      }
      if(controller.signal.aborted)return;
      let request;try{request=JSON.parse(body);}catch{this.error(res,400,'Invalid JSON request');return;}
      const provider=this.providers.get(match[2]);if(!provider){this.error(res,404,'Connection removed');return;}
      const key=await this.keychain.get(provider.id);
      const upstreamRequest=this.fetchImpl(provider.baseUrl.replace(/\/$/,'')+'/'+match[3],{
        method:'POST',body,redirect:'manual',signal:controller.signal,
        headers:{'Content-Type':'application/json','Accept':'text/event-stream','Authorization':`Bearer ${key}`},
      });
      // The attempted destination is known once dispatched, including when the
      // service later fails. Do not wait for response headers or the whole turn.
      if(match[3]==='responses')void this.routeEvidence.record({threadId:req.headers['thread-id'],providerId:provider.id,model:request?.model}).then(()=>this.onRoute()).catch(()=>{});
      const upstream=await upstreamRequest;
      clearTimeout(timeout);
      if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();this.error(res,502,'Provider redirects are not supported');return;}
      res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
      if(upstream.body)await pipeline(Readable.fromWeb(upstream.body),res);else res.end();
    }catch{if(!res.destroyed)this.error(res,502,'Provider request failed. Check the connection and keep Pawprint running.');}
    finally{clearTimeout(timeout);this.requests.delete(controller);req.off('aborted',stop);res.off('close',stop);}
  }
  async close(){
    if(this.starting)await this.starting.catch(()=>{});
    for(const controller of this.requests)controller.abort();
    const server=this.server;this.server=null;
    if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    await this.routeEvidence.queue;
  }
}
