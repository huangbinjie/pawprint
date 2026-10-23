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
export function proxyHeaders(input,{request=false}={}){
  const incoming=new Headers();
  if(input instanceof Headers){for(const [name,value] of input)incoming.append(name,value);}
  else for(const [name,value] of Object.entries(input))if(value!=null)for(const part of Array.isArray(value)?value:[value])incoming.append(name,part);
  const blocked=new Set([...hopByHop,...(incoming.get('connection')||'').split(',').map(s=>s.trim().toLowerCase())]);
  const result={};
  for(const [name,value] of incoming){
    if(blocked.has(name)||privateHeader(name)||(request?requestFraming.has(name):name==='alt-svc'))continue;
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
