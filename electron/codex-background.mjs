import {readFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';

const run=promisify(execFile);

// Fixed code sent to the client's renderer; local artwork is passed as data.
export async function renderCodexBackground({media,intro,dim=0,revision}={}) {
  const key='__pawprintCodexBackground';
  if(!media){window[key]?.restore();return {applied:false};}
  const mainSelector='main[data-app-shell-main-surface]';
  const main=[...document.querySelectorAll(mainSelector)].find(e=>!e.closest('[data-app-shell-active-page="false"]')&&e.getBoundingClientRect().width);
  if(!main||!main.getBoundingClientRect().width)throw Error('No visible supported Codex main surface.');
  const [url,introUrl]=[media,intro].map(value=>{
    if(!value)return null;
    const [header,data]=value.split(',');
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes],{type:header.slice(5,header.indexOf(';'))}));
  });
  const video=media.startsWith('data:video/');
  const art=video?document.createElement('video'):new Image();
  try{
    if(video){
      art.muted=true;art.loop=true;art.playsInline=true;art.disablePictureInPicture=true;art.dataset.phase='idle';
      await new Promise((resolve,reject)=>{
        art.addEventListener('loadeddata',resolve,{once:true});
        art.addEventListener('error',()=>reject(Error('Could not decode background video.')),{once:true});
        art.src=url;
      });
      await art.play();
    }else{art.src=url;await art.decode();}
  }catch(error){
    if(video){art.pause();art.removeAttribute('src');art.load();}
    URL.revokeObjectURL(url);if(introUrl)URL.revokeObjectURL(introUrl);throw error;
  }
  window[key]?.restore();
  const root=document.documentElement,marks=new Set(),nestedThemes=new Map(),nativeTheme=root.getAttribute('data-theme');
  const layer=document.createElement('div');layer.id='pawprint-codex-background';
  layer.setAttribute('aria-hidden','true');
  Object.assign(layer.style,{position:'fixed',inset:'0',zIndex:'-1',pointerEvents:'none',
    backgroundImage:video?'none':`${dim>0?`linear-gradient(rgb(0 0 0 / ${dim}),rgb(0 0 0 / ${dim})),`:''}url("${url}")`,
    backgroundSize:'cover',backgroundPosition:'center'});
  if(video){
    Object.assign(art.style,{width:'100%',height:'100%',objectFit:'cover'});
    layer.append(art);
    if(dim>0){
      const scrim=document.createElement('div');
      Object.assign(scrim.style,{position:'absolute',inset:'0',background:`rgb(0 0 0 / ${dim})`});
      layer.append(scrim);
    }
  }
  const style=document.createElement('style');
  style.textContent=`
    html[data-pawprint-background] {color-scheme:dark;--color-text-primary:#fff;--color-text-prose:#fff;--color-text-secondary:#e8edf5;--color-text-tertiary:#d3dcea}
    html[data-pawprint-background] body {isolation:isolate;background:transparent!important}
    html[data-pawprint-background] [data-pawprint-background-shell] {background:transparent!important}
    html[data-pawprint-background] main[data-app-shell-main-surface] {background:transparent!important;text-shadow:0 1px 3px rgb(0 0 0 / .8)}
    html[data-pawprint-background] [data-markdown-text-style="assistant-message"] {color:#fff!important;-webkit-text-stroke:0;paint-order:normal;text-shadow:0 1px 1px rgb(0 0 0 / .3)}
    html[data-pawprint-background] [data-markdown-text-style="assistant-message"]:not([data-markdown-text-style="assistant-message"] *) {background:rgb(13 18 27 / .66);backdrop-filter:blur(10px);border:1px solid rgb(255 255 255 / .1);border-radius:16px;padding:14px 18px}
    html[data-pawprint-background] [data-markdown-text-style="assistant-message"] :is(p,li,strong,em) {color:#fff!important}
    html[data-pawprint-background] aside.app-shell-left-panel {background:transparent!important}
    html[data-pawprint-background] [data-sidebar-navigation-root] {background:rgb(14 18 26 / .48)!important;backdrop-filter:blur(16px)}
    html[data-pawprint-background] header[data-app-shell-header-edge-scroll] {background:rgb(14 18 26 / .18)!important}
    html[data-pawprint-background] [data-composer-surface-variant] {background:rgb(24 31 43)!important;backdrop-filter:none!important;border:1px solid rgb(255 255 255 / .14);box-shadow:0 4px 16px rgb(0 0 0 / .12)}
    html[data-pawprint-background] .messaging-root {color-scheme:dark;--color-background-primary:transparent;--color-text-primary:#fff;--color-text-secondary:#e8edf5;background:transparent!important}
    html[data-pawprint-background] .messaging-root :is(.workspace,.thread-pane,.conversation-footer,.composer-disclaimer) {background:transparent!important}
    html[data-pawprint-background] .messaging-root .message-bubble {background:rgb(13 18 27 / .66)!important;color:#fff!important;text-shadow:none;backdrop-filter:blur(10px)}
    html[data-pawprint-background] .messaging-root .message-bubble :is(p,li,strong,em) {color:inherit!important}
    html[data-pawprint-background] .messaging-root .thread-pane {color:#fff}
    html[data-pawprint-background] .messaging-root [data-markdown-text-style="assistant-message"] {background:transparent!important;backdrop-filter:none;border:0;padding:0}
    html[data-pawprint-background] .messaging-root :is(.conversation-footer,.thread-pane)::before,
    html[data-pawprint-background] .messaging-root :is(.conversation-footer,.thread-pane)::after {background:transparent!important}
    html[data-pawprint-background] main:has([data-density]) [class~="electron:bg-surface"] {background:rgb(14 18 26 / .48)!important;backdrop-filter:blur(10px)}
    html[data-pawprint-background] main:has([data-density]) [class*="_MainContentFrame_"] {margin-top:0!important}
    html[data-pawprint-background] main:has([data-density]) [class~="draggable"][class*="electron:h-toolbar"]:empty {height:0!important;min-height:0!important;padding-block:0!important}
    html[data-pawprint-background] [data-thread-scroll-footer],
    html[data-pawprint-background] [data-thread-scroll-footer]::before,
    html[data-pawprint-background] [data-thread-scroll-footer]::after,
    html[data-pawprint-background] [data-thread-scroll-footer] [class*="_background_"][class*="_surface_"],
    html[data-pawprint-background] [data-thread-scroll-footer] [class*="_background_"][class*="_fade_"],
    html[data-pawprint-background] main[data-app-shell-main-surface] [class*="_background_"][class*="_fade_"],
    html[data-pawprint-background] main[data-app-shell-main-surface] [class*="_background_"][class*="_combined_"],
    html[data-pawprint-background] [class*="_MainContentTopFade_"],
    html[data-pawprint-background] [data-app-shell-main-content-top-fade]:empty {background:transparent!important}
  `;
  const finishIntro=()=>{
    art.loop=true;art.dataset.phase='idle';art.src=url;
    if(!document.hidden)void art.play().catch(()=>{});
  };
  if(video&&introUrl)art.addEventListener('ended',finishIntro);
  let wasHome=false;
  const markShells=()=>{
    for(const themed of document.querySelectorAll('.messaging-root')){
      if(!nestedThemes.has(themed))nestedThemes.set(themed,themed.getAttribute('data-theme'));
      if(themed.getAttribute('data-theme')!=='dark')themed.setAttribute('data-theme','dark');
    }
    for(const surface of document.querySelectorAll(`${mainSelector},aside.app-shell-left-panel`)){
      for(let parent=surface.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
        if(!parent.hasAttribute('data-pawprint-background-shell')){
          parent.setAttribute('data-pawprint-background-shell','');marks.add(parent);
        }
      }
    }
    if(video&&introUrl){
      const home=[...document.querySelectorAll('[data-codex-composer-root][data-composer-placement="home"]')].some(e=>!e.closest('[data-app-shell-active-page="false"]')&&e.getBoundingClientRect().width);
      if(home&&!wasHome){art.loop=false;art.dataset.phase='intro';art.src=introUrl;if(!document.hidden)void art.play().catch(()=>{});}
      wasHome=home;
    }
  };
  markShells();document.head.append(style);document.body.prepend(layer);
  root.setAttribute('data-theme','dark');
  root.setAttribute('data-pawprint-background','');
  const observer=new MutationObserver(markShells);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-app-shell-active-page','data-composer-placement','data-theme']});
  const updatePlayback=()=>{
    if(!video)return;
    if(document.hidden)art.pause();else void art.play().catch(()=>{});
  };
  if(video){document.addEventListener('visibilitychange',updatePlayback);updatePlayback();}
  window[key]={revision,restore(){observer.disconnect();document.removeEventListener('visibilitychange',updatePlayback);
    if(video){art.removeEventListener('ended',finishIntro);art.pause();art.removeAttribute('src');art.load();}
    layer.remove();style.remove();
    for(const element of marks)element.removeAttribute('data-pawprint-background-shell');
    for(const [element,theme] of nestedThemes){if(theme===null)element.removeAttribute('data-theme');else element.setAttribute('data-theme',theme);}
    root.removeAttribute('data-pawprint-background');
    if(nativeTheme===null)root.removeAttribute('data-theme');else root.setAttribute('data-theme',nativeTheme);
    URL.revokeObjectURL(url);if(introUrl)URL.revokeObjectURL(introUrl);delete window[key];}};
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const composer=[...document.querySelectorAll('[data-composer-surface-variant], [contenteditable="true"], textarea')].find(e=>!e.closest('[data-app-shell-active-page="false"]')&&e.getBoundingClientRect().width);
  return {applied:true,width:video?art.videoWidth:art.naturalWidth,height:video?art.videoHeight:art.naturalHeight,
    ...(video?{playing:!art.paused,duration:art.duration}:{}),
    mainVisible:main.getBoundingClientRect().width>0,composerVisible:Boolean(composer?.getBoundingClientRect().width)};
}

export async function readBackgroundMedia(file,dim=0) {
  if(!Number.isFinite(dim)||dim<0||dim>0.9)throw Error('Background dim must be between 0 and 0.9.');
  const info=await stat(file);
  if(!info.isFile()||!info.size||info.size>32*1024*1024)throw Error('Choose background media smaller than 32 MiB.');
  const bytes=await readFile(file);
  let mime;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
  else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
  else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mime='image/webp';
  else if(bytes.subarray(4,8).toString()==='ftyp')mime='video/mp4';
  else if(bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])))mime='video/webm';
  else throw Error('Choose PNG, JPEG, WebP, MP4 or WebM background media.');
  return {media:`data:${mime};base64,${bytes.toString('base64')}`,dim};
}

export async function verifyBackgroundEndpoint(port) {
  if(process.platform!=='darwin')throw Error('This background prototype currently supports macOS.');
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid background connection port.');
  let output;
  // A child process may inherit the listener FD; identify the client itself.
  try{output=(await run('/usr/sbin/lsof',['-nP','-a','-c','/^(ChatGPT|Codex)$/',`-iTCP:${port}`,'-sTCP:LISTEN','-Fpun'])).stdout;}
  catch{throw Error(`Client background connection is not enabled on port ${port}.`);}
  const fields=output.trim().split('\n');
  if(fields.filter(x=>x.startsWith('p')).length!==1||!fields.includes(`u${process.getuid()}`)
    ||fields.filter(x=>x.startsWith('n')).some(x=>x!==`n127.0.0.1:${port}`))throw Error('Background connection must belong to your client and listen only on 127.0.0.1.');
  const pid=fields.find(x=>x.startsWith('p')).slice(1);
  const executable=(await run('/bin/ps',['-p',pid,'-o','comm='])).stdout.trim();
  const bundles=['/Applications/ChatGPT.app','/Applications/Codex.app',path.join(process.env.HOME,'Applications/ChatGPT.app'),path.join(process.env.HOME,'Applications/Codex.app')];
  const bundle=bundles.find(b=>executable===`${b}/Contents/MacOS/ChatGPT`||executable===`${b}/Contents/MacOS/Codex`);
  if(!bundle)throw Error('Background connection does not belong to the installed official client.');
  await run('/usr/bin/codesign',['--verify','--strict','--test-requirement','=anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"',bundle]);
}

// Internal transport used only after checking the endpoint owner above.
export async function backgroundCdpRequest(webSocketUrl,expression) {
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(webSocketUrl);
    const timer=setTimeout(()=>finish(Error('Background operation timed out.')),10000);
    const finish=(error,value)=>{clearTimeout(timer);socket.close();error?reject(error):resolve(value);};
    socket.addEventListener('open',()=>socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})));
    socket.addEventListener('error',()=>finish(Error('Client background connection failed.')));
    socket.addEventListener('close',()=>{clearTimeout(timer);reject(Error('Client background connection closed.'));});
    socket.addEventListener('message',event=>{
      let reply;try{reply=JSON.parse(event.data);}catch{finish(Error('Invalid background connection response.'));return;}
      if(reply.id!==1)return;
      if(reply.error||reply.result?.exceptionDetails){finish(Error(reply.error?.message||reply.result.exceptionDetails.exception?.description||'Background operation failed.'));return;}
      finish(null,reply.result?.result?.value);
    });
  });
}

export async function setCodexBackground({port=9342,file,introFile,dim=0,restore=false,prepared,targetId}={}) {
  const payload=prepared||(restore?{}:await readBackgroundMedia(file,dim));
  if(introFile&&!restore){
    const opening=await readBackgroundMedia(introFile);
    if(!payload.media.startsWith('data:video/')||!opening.media.startsWith('data:video/'))throw Error('An opening animation requires two video files.');
    payload.intro=opening.media;
  }
  await verifyBackgroundEndpoint(port);
  const response=await fetch(`http://127.0.0.1:${port}/json/list`,{redirect:'error',signal:AbortSignal.timeout(2500)});
  if(!response.ok)throw Error('Could not discover client background windows.');
  const targets=await response.json(),candidates=[];
  if(!Array.isArray(targets))throw Error('Invalid client window list.');
  for(const target of targets){
    if(targetId&&target.id!==targetId)continue;
    if(target.type!=='page'||typeof target.url!=='string'||typeof target.webSocketDebuggerUrl!=='string')continue;
    const page=new URL(target.url),socket=new URL(target.webSocketDebuggerUrl);
    if(page.protocol!=='app:'||page.pathname!=='/index.html')continue;
    if(socket.protocol!=='ws:'||socket.hostname!=='127.0.0.1'||socket.port!==String(port)||socket.username||socket.password||!/^\/devtools\/page\/[^/?#]+$/.test(socket.pathname)||socket.search||socket.hash)throw Error('Invalid client background window endpoint.');
    const visible=await backgroundCdpRequest(socket.href,`({visible:!document.hidden&&[...document.querySelectorAll('main[data-app-shell-main-surface]')].some(e=>!e.closest('[data-app-shell-active-page="false"]')&&e.getBoundingClientRect().width),focused:document.hasFocus()})`);
    if(visible?.visible)candidates.push({...target,focused:visible.focused});
  }
  const target=candidates.find(x=>x.focused)||candidates[0];
  if(!target)throw Error('No visible supported client window. Open a Codex chat first.');
  const result=await backgroundCdpRequest(target.webSocketDebuggerUrl,`(${renderCodexBackground.toString()})(${JSON.stringify(payload)})`);
  if(!result||result.applied!==!restore)throw Error('Client did not confirm the background operation.');
  return result;
}
