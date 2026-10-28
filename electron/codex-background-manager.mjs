import {readFile,writeFile,mkdir,rename,unlink,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readBackgroundMedia,setCodexBackground,verifyBackgroundEndpoint,backgroundCdpRequest} from './codex-background.mjs';
import {SKIN_FILES,ensureSkinFile} from './codex-skin-assets.mjs';

const run=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assetName=/^[a-f0-9-]+\.(png|jpg|webp|mp4|webm)$/;
const validAsset=file=>assetName.test(file)||Object.keys(SKIN_FILES).some(id=>file===`assets/${id}.mp4`);
export const CODEX_SKINS=[
  {id:'night',name:'夜窗陪伴',englishName:'Night Companion',description:'女生、猫咪与城市夜景',englishDescription:'A quiet evening with a companion and cat',media:'night-idle',intro:'night-intro'},
  {id:'cat',name:'暖阳猫窝',englishName:'Sunny Cat Room',description:'暖阳小屋里的猫咪陪伴',englishDescription:'A cozy room with a little cat',media:'cat-idle-v2'},
  {id:'dog',name:'阳光狗屋',englishName:'Sunny Puppy Room',description:'阳光、软垫与活泼小狗',englishDescription:'A sunny room with a playful puppy',media:'dog-idle'},
];

export class CodexBackgroundManager {
  constructor({directory,platform=process.platform,apply=setCodexBackground,readMedia=readBackgroundMedia,probe,launch,assetFile=ensureSkinFile}={}){
    this.directory=path.join(directory,'codex-background');this.platform=platform;this.apply=apply;this.readMedia=readMedia;
    this.config={version:1,enabled:false,revision:randomUUID(),media:null,intro:null};this.status='off';this.error='';
    this.probe=probe||this.probeClient.bind(this);this.launch=launch||this.launchClient.bind(this);
    this.assetFile=assetFile;
  }
  snapshot(){return {...this.config,download:this.downloading||null,supported:this.platform==='darwin',status:this.status,error:this.error};}
  async load(){
    try{
      const value=JSON.parse(await readFile(path.join(this.directory,'settings.json'),'utf8'));
      if(value.version!==1||typeof value.enabled!=='boolean'||typeof value.revision!=='string'||(value.enabled&&!value.media)||[value.media,value.intro].some(x=>x&&(!validAsset(x.file)||typeof x.name!=='string'||!['image/png','image/jpeg','image/webp','video/mp4','video/webm'].includes(x.mime))))throw Error('背景配置损坏，请重新选择素材。');
      this.config=value;
      if(!this.config.presetId&&this.config.media?.name==='qqmusic-night-room-idle.mp4'){this.config.presetId='night';await this.save();}
      if(this.config.enabled&&this.config.presetId==='cat'&&this.config.media.file==='assets/cat-idle.mp4'){
        await this.assetFile('cat-idle-v2',path.join(this.directory,'assets'));
        this.config.media={...this.config.media,file:'assets/cat-idle-v2.mp4'};
        this.config.revision=randomUUID();await this.save();
      }
    }catch(error){if(error.code!=='ENOENT'){this.error=error.message;this.status='error';}}
    if(this.config.media)try{await this.prepare();}catch(error){this.status='error';this.error=error.message;this.config.enabled=false;}
    return this.snapshot();
  }
  async prepare(){
    this.payload=await this.readMedia(path.join(this.directory,this.config.media.file));
    if(this.config.intro)this.payload.intro=(await this.readMedia(path.join(this.directory,this.config.intro.file))).media;
    this.payload.revision=this.config.revision;
  }
  async presets(){
    return CODEX_SKINS.map(({id,name,englishName,description,englishDescription})=>({id,name,englishName,description,englishDescription}));
  }
  async selectPreset(id){
    if(this.downloading)throw Error('正在下载皮肤，请稍候。');
    if(id==='default')return this.enable(false);
    const skin=CODEX_SKINS.find(skin=>skin.id===id);if(!skin)throw Error('无效的预制皮肤。');
    if(this.config.presetId===id&&this.config.media?.file===`assets/${skin.media}.mp4`)return this.enable(true);
    const previous=[this.config.media,this.config.intro].filter(Boolean);
    const next={...this.config,presetId:id,enabled:true,revision:randomUUID(),media:null,intro:null};
    const payload={revision:next.revision,dim:0},total=SKIN_FILES[skin.media].size+(skin.intro?SKIN_FILES[skin.intro].size:0);let before=0;
    this.downloading={id,percent:0};this.error='';
    try{
      for(const kind of ['media','intro']){
        if(!skin[kind])continue;
        const file=await this.assetFile(skin[kind],path.join(this.directory,'assets'),{onProgress:loaded=>{this.downloading={id,percent:Math.round((before+loaded)/total*100)};}});
        const content=await this.readMedia(file);next[kind]={file:`assets/${skin[kind]}.mp4`,name:skin.name+(kind==='intro'?' · 开场':' · 循环'),mime:'video/mp4'};payload[kind]=content.media;before+=SKIN_FILES[skin[kind]].size;
      }
      this.config=next;this.payload=payload;await this.save();
      for(const asset of previous)if(assetName.test(asset.file))await rm(path.join(this.directory,asset.file),{force:true});
    }finally{this.downloading=null;}
    await this.sync();return this.snapshot();
  }
  async save(){
    await mkdir(this.directory,{recursive:true});
    const file=path.join(this.directory,'settings.json');
    await writeFile(file+'.tmp',JSON.stringify(this.config)+'\n',{mode:0o600});await rename(file+'.tmp',file);
  }
  async select(kind,file){
    if(!['media','intro'].includes(kind))throw Error('无效的背景素材类型。');
    const payload=await this.readMedia(file),mime=payload.media.slice(5,payload.media.indexOf(';'));
    if(kind==='intro'&&(!mime.startsWith('video/')||!this.config.media?.mime.startsWith('video/')))throw Error('请先选择视频背景，再选择开场视频。');
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'}[mime];
    await mkdir(this.directory,{recursive:true});const filename=`${randomUUID()}.${extension}`;
    await writeFile(path.join(this.directory,filename),Buffer.from(payload.media.split(',')[1],'base64'),{mode:0o600});
    const old=[this.config[kind]];this.config[kind]={file:filename,name:path.basename(file),mime};
    if(kind==='media'&&!mime.startsWith('video/')){old.push(this.config.intro);this.config.intro=null;}
    this.config.revision=randomUUID();await this.save();await this.prepare();
    for(const asset of old.filter(Boolean))await unlink(path.join(this.directory,asset.file));
    await this.sync();return this.snapshot();
  }
  async clearIntro(){
    const old=this.config.intro;this.config.intro=null;this.config.revision=randomUUID();await this.save();
    if(this.config.media)await this.prepare();if(old)await unlink(path.join(this.directory,old.file));
    await this.sync();return this.snapshot();
  }
  async enable(enabled){
    if(typeof enabled!=='boolean')throw Error('无效的背景开关。');
    if(enabled&&!this.config.media)throw Error('请先选择图片或视频。');
    this.config.enabled=enabled;await this.save();await this.sync();return this.snapshot();
  }
  async probeClient(){
    const {stdout}=await run('/bin/ps',['-axo','pid=,comm=']);
    const match=stdout.split('\n').map(line=>line.trim().match(/^(\d+)\s+(\/Applications\/(?:ChatGPT|Codex)\.app)\/Contents\/MacOS\/(?:ChatGPT|Codex)$/)).find(Boolean);
    if(!match)return {pid:null,connected:false};
    const pid=Number(match[1]),bundle=match[2];
    try{if(this.verifiedPid!==pid){await verifyBackgroundEndpoint(9342);this.verifiedPid=pid;}}catch{return {pid,bundle,connected:false};}
    const response=await fetch('http://127.0.0.1:9342/json/list',{redirect:'error',signal:AbortSignal.timeout(2000)});
    const targets=await response.json();const windows=[];
    for(const t of targets){
      if(t.type!=='page'||!t.url?.startsWith('app://')||new URL(t.url).pathname!=='/index.html')continue;
      const endpoint=new URL(t.webSocketDebuggerUrl);
      if(endpoint.protocol!=='ws:'||endpoint.host!=='127.0.0.1:9342'||!/^\/devtools\/page\/[^/?#]+$/.test(endpoint.pathname)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('无效的背景窗口连接。');
      const state=await backgroundCdpRequest(endpoint.href,`({revision:window.__pawprintCodexBackground?.revision,applied:Boolean(window.__pawprintCodexBackground),visible:!document.hidden&&[...document.querySelectorAll('main[data-app-shell-main-surface]')].some(e=>!e.closest('[data-app-shell-active-page="false"]')&&e.getBoundingClientRect().width)})`);
      windows.push({id:t.id,...state});
    }
    return {pid,bundle,connected:true,windows};
  }
  async launchClient(client){
    this.connectingUntil=Date.now()+20000;
    const bundle=client.bundle||'/Applications/ChatGPT.app';
    await run('/usr/bin/codesign',['--verify','--strict','--test-requirement','=anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"',bundle]);
    if(client.pid){
      await run('/usr/bin/osascript',['-e','tell application id "com.openai.codex" to quit'],{timeout:20000});
      let stopped=false;
      for(let i=0;i<60;i++){try{process.kill(client.pid,0);}catch{stopped=true;break;}await sleep(250);}
      if(!stopped)throw Error('客户端尚未正常退出，已停止重开。');
    }
    await run('/usr/bin/open',['-na',bundle,'--args','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9342']);
  }
  async reconnect(){
    if(!this.config.enabled)throw Error('请先开启背景。');
    if(this.busy)throw Error('背景正在连接，请稍候。');
    this.busy=true;this.status='connecting';
    try{await this.launch(await this.probe());this.lastPid=null;}finally{this.busy=false;}
    await this.sync();return this.snapshot();
  }
  async sync(){
    if(this.busy||this.downloading||this.platform!=='darwin'||this.closed)return;this.busy=true;
    try{
      const client=await this.probe();const restarted=this.observed&&client.pid&&client.pid!==this.lastPid;
      this.observed=true;this.lastPid=client.pid;
      if(!this.config.enabled){
        for(const w of client.windows||[])if(w.visible&&w.applied)await this.apply({targetId:w.id,restore:true});
        this.status='off';this.error='';return;
      }
      if(!client.connected){
        this.status=client.pid?'needs-connection':'waiting';
        if(restarted&&Date.now()>(this.connectingUntil||0)){this.status='connecting';await this.launch(client);}
        return;
      }
      const visible=client.windows.filter(w=>w.visible);
      for(const w of visible)if(w.revision!==this.config.revision)await this.apply({targetId:w.id,prepared:this.payload});
      this.status=visible.length?'applied':'waiting';this.error='';
    }catch(error){this.status='error';this.error=error.message;}
    finally{this.busy=false;}
  }
  start(){if(this.platform!=='darwin')return;void this.sync();this.timer=setInterval(()=>void this.sync(),3000);this.timer.unref();}
  close(){this.closed=true;clearInterval(this.timer);}
}
