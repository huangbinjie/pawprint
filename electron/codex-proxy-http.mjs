import http from 'node:http';import https from 'node:https';
import {Readable} from 'node:stream';

const hopByHop=new Set(['connection','keep-alive','proxy-connection','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const requestFraming=new Set(['host','content-length','content-encoding','expect','content-md5','digest','content-digest','repr-digest']);
function privateHeader(name){
  const normalized=name.replaceAll('_','-');
  return /(?:^|-)(?:auth|authorization|authentication|cookie|cookie2|token|secret|credential|credentials|api-key|apikey|identity)(?:-|$)/.test(normalized)
    || /^(?:x-)?(?:chatgpt|openai)-(?:account|organization|project|workspace|user)(?:-|$)/.test(normalized)
    || /(?:^|-)(?:account|organization|project|workspace|user)-id(?:-|$)/.test(normalized)
    || normalized==='forwarded'||normalized.startsWith('x-forwarded-')||normalized==='x-real-ip'||normalized==='referer';
}

// Preserve end-to-end protocol headers, including future feature flags. Remove
// credentials/identity and both standard and Connection-nominated hop headers.
export function proxyHeaders(input,{request=false,identity=false}={}){
  const incoming=new Headers();
  if(input instanceof Headers){for(const [name,value] of input)incoming.append(name,value);}
  else for(const [name,value] of Object.entries(input))if(value!=null)for(const part of Array.isArray(value)?value:[value])incoming.append(name,part);
  const blocked=new Set([...hopByHop,...(incoming.get('connection')||'').split(',').map(s=>s.trim().toLowerCase())]);
  const result={};
  for(const [name,value] of incoming){
    const normalized=name.replaceAll('_','-');
    const nativeIdentity=identity&&!/(?:^|-)(?:cookie|cookie2)(?:-|$)/.test(normalized)&&normalized!=='forwarded'&&!normalized.startsWith('x-forwarded-')&&!['x-real-ip','referer'].includes(normalized);
    if(blocked.has(name)||(privateHeader(name)&&!nativeIdentity)||(request?requestFraming.has(name):name==='alt-svc'))continue;
    result[name]=value;
  }
  return result;
}

// Node fetch transparently decompresses a response but retains its encoding
// headers. A raw HTTP stream lets this proxy preserve bytes and headers together.
export function requestProvider(url,{method,headers,body,signal}){
  return new Promise((resolve,reject)=>{
    const transport=new URL(url).protocol==='https:'?https:http;
    const req=transport.request(url,{method,headers,signal},response=>{
      const headers=new Headers();
      for(let i=0;i<response.rawHeaders.length;i+=2)headers.append(response.rawHeaders[i],response.rawHeaders[i+1]);
      resolve({status:response.statusCode,headers,body:Readable.toWeb(response)});
    });
    req.on('error',reject);req.end(body);
  });
}

// Electron's native fetch uses the system proxy/certificate configuration.
// Fetch decodes HTTP compression, so its original representation headers must
// not accompany the decoded stream returned to the Codex client.
export function officialRequester(fetchImpl){return async(url,options)=>{
  // Chromium owns framing and Fetch Metadata. Node's explicit length and
  // caller-supplied Sec-Fetch-* cause local net::ERR_INVALID_ARGUMENT failures.
  // Keep application/protocol headers; let this transport build its own framing.
  const requestHeaders=new Headers(options.headers);
  for(const name of [...requestHeaders.keys()])if(requestFraming.has(name)||hopByHop.has(name)||name.startsWith('sec-fetch-'))requestHeaders.delete(name);
  const response=await fetchImpl(url,{...options,headers:requestHeaders,credentials:'omit'}),headers=new Headers(response.headers);
  for(const name of ['content-encoding','content-length','content-md5','digest','content-digest','repr-digest'])headers.delete(name);
  return {status:response.status,headers,body:response.body};
};}
