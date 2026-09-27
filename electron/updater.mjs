import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream, openSync, closeSync } from 'node:fs';
import { mkdtemp, rm, stat, lstat, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const RELEASE_REPO = 'huangbinjie/pawprint';
const releaseUrl = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const zipName = version => `Pawprint-${version}-mac-arm64.zip`;
export function releaseAssetName(version, platform, arch) {
  if (platform === "darwin" && arch === "arm64") return zipName(version);
  if (platform === "win32" && arch === "x64") return `Pawprint-${version}-win-x64-setup.exe`;
  return null;
}
const parse = value => { const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || ''); return m ? m.slice(1).map(Number) : null; };
export function newer(candidate, installed) {
  const a=parse(candidate),b=parse(installed);
  if (!a || !b) return false;
  for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]>b[i];
  return false;
}
export function selectRelease(release, installed, platform = "darwin", arch = "arm64") {
  if (!release || release.draft || release.prerelease || !newer(release.tag_name,installed)) return null;
  const version=release.tag_name.replace(/^v/,'');
  const filename=releaseAssetName(version,platform,arch);
  if (!filename) return null;
  const zip=release.assets?.find(a=>a.name===filename);
  const checksum=release.assets?.find(a=>a.name===`${filename}.sha256`);
  if(!zip || !checksum || zip.size<100_000 || zip.size>800_000_000) return null;
  for(const asset of [zip,checksum]) {
    let u;
    try { u=new URL(asset.browser_download_url); } catch { return null; }
    if(u.protocol!=='https:' || u.hostname!=='github.com' || u.pathname!==`/${RELEASE_REPO}/releases/download/${release.tag_name}/${asset.name}`) return null;
  }
  return {version,tag:release.tag_name,manual:false,filename,platform,arch,page:`https://github.com/${RELEASE_REPO}/releases/tag/${encodeURIComponent(release.tag_name)}`,notes:release.body?.slice(0,3000)||'',zip:zip.browser_download_url,checksum:checksum.browser_download_url,size:zip.size};
}
async function response(url, fetcher, timeoutMs=45_000) {
  const r=await fetcher(url,{headers:{'User-Agent':'Pawprint-Updater','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(timeoutMs)});
  if(!r.ok) throw new Error(`GitHub 返回 ${r.status}`);
  return r;
}
export function checksumFrom(text, filename) {
  const line=text.trim().split(/\r?\n/).find(x=>x.endsWith(`  ${filename}`));
  const m=/^([a-fA-F0-9]{64})  (.+)$/.exec(line || '');
  if(!m || m[2]!==filename) throw new Error('发布包缺少有效校验文件。');
  return m[1].toLowerCase();
}
export async function verifiedDownload(release, directory, fetcher=fetch, onProgress=()=>{}) {
  const filename=release.filename || zipName(release.version);
  if (filename !== releaseAssetName(release.version, release.platform || 'darwin', release.arch || 'arm64')) throw new Error('安装包名称不匹配。');
  const expected=checksumFrom(await (await response(release.checksum,fetcher)).text(),filename);
  // The abort signal remains active while the entire 100+ MB body streams.
  const r=await response(release.zip,fetcher,10 * 60_000);
  if(!r.body) throw new Error('下载包为空。');
  const target=path.join(directory,filename);
  let loaded=0;
  const meter=new Transform({ transform(chunk,_encoding,done) {
    loaded+=chunk.length;
    if(loaded>release.size) return done(new Error('安装包大小与发布记录不一致。'));
    onProgress({loaded,total:release.size,percent:Math.round(loaded/release.size*100)});done(null,chunk);
  }});
  await pipeline(Readable.fromWeb(r.body),meter,createWriteStream(target,{flags:'wx'}));
  const size=(await stat(target)).size;
  if(size!==release.size) throw new Error('安装包大小与发布记录不一致。');
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(target)) hash.update(chunk);
  if(hash.digest('hex')!==expected) throw new Error('安装包校验失败。');
  return target;
}
async function bundleValue(appPath,key) {
  const {stdout}=await run('/usr/libexec/PlistBuddy',['-c',`Print ${key}`,path.join(appPath,'Contents/Info.plist')],{timeout:10_000});
  return stdout.trim();
}
export async function stageUpdate(release,currentApp,{fetcher=fetch,workArea=tmpdir(),onProgress=()=>{}}={}) {
  if(process.platform!=='darwin') throw new Error('目前只支持 Apple 芯片 Mac 更新。');
  const root=await mkdtemp(path.join(workArea,'pawprint-update-'));
  const staged=path.join(root,'Pawprint.app');
  try{
    const archive=await verifiedDownload(release,root,fetcher,onProgress);
    await run('/usr/bin/ditto',['-x','-k',archive,root],{timeout:180_000});
    if(!(await lstat(staged)).isDirectory()) throw new Error('安装包缺少 Pawprint.app。');
    if(await bundleValue(staged,'CFBundleIdentifier')!=='studio.binmax.pawprint') throw new Error('安装包应用标识不匹配。');
    if(await bundleValue(staged,'CFBundleShortVersionString')!==release.version) throw new Error('安装包版本不匹配。');
    const ready=path.join(path.dirname(currentApp),`.Pawprint-new-${randomUUID()}.app`);
    await run('/usr/bin/ditto',[staged,ready],{timeout:180_000});
    return {root,ready};
  }catch(e){await rm(root,{recursive:true,force:true});throw e}
}
export async function stageWindowsUpdate(release,_currentApp,{fetcher=fetch,workArea=tmpdir(),onProgress=()=>{}}={}) {
  const root=await mkdtemp(path.join(workArea,'pawprint-update-'));
  try {
    const ready=await verifiedDownload(release,root,fetcher,onProgress);
    const hash=createHash('sha256');
    for await(const chunk of createReadStream(ready)) hash.update(chunk);
    return {root,ready,sha256:hash.digest('hex')};
  } catch(error) { await rm(root,{recursive:true,force:true});throw error; }
}
function detached(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{detached:true,stdio:'ignore',...options});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve(child);});
  });
}
export function launchInstaller(currentApp,ready,root,pid) {
  const script=path.join(process.resourcesPath,'updater/install-update.sh');
  return detached('/bin/sh',[script,currentApp,ready,root,String(pid)]);
}
export async function launchWindowsInstaller(currentApp,ready,root,pid,sha256,{scriptPath=path.join(process.resourcesPath,'updater/install-update.ps1')}={}) {
  const script=await readFile(scriptPath,'utf8');
  // Run our packaged helper as a command. No execution-policy changes, shell
  // interpolation of paths, or machine-wide security settings are needed.
  const log=openSync(root+'.log','a');
  try {
    // UTF-16 command encoding avoids Windows command-line quoting of the script.
    const executable=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const bootstrap="Start-Process -FilePath $env:PAWPRINT_UPDATE_POWERSHELL -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$env:PAWPRINT_UPDATE_SCRIPT) -WindowStyle Hidden | Out-Null";
    const child=await detached(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{detached:false,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,
      PAWPRINT_UPDATE_POWERSHELL:executable,PAWPRINT_UPDATE_SCRIPT:Buffer.from(script,'utf16le').toString('base64'),PAWPRINT_UPDATE_INSTALLER:ready,PAWPRINT_UPDATE_CURRENT:currentApp,PAWPRINT_UPDATE_ROOT:root,PAWPRINT_UPDATE_PID:String(pid),PAWPRINT_UPDATE_SHA256:sha256}});
    let started=false;
    for(let attempt=0;attempt<100;attempt++) {
      try { await access(path.join(root,'helper.ready'));started=true;break; } catch {}
      if((child.exitCode!==null && child.exitCode!==0) || child.signalCode!==null) throw new Error('Windows 更新辅助进程启动失败（'+child.exitCode+'/'+child.signalCode+'），请查看 '+root+'.log');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!started) { child.kill();throw new Error('Windows 更新辅助进程未就绪，应用没有退出。'); }

  } finally { closeSync(log); }

}
export class UpdateService {
  constructor({installed,appPath,onChange=()=>{},fetcher=fetch,install,stage,quit=()=>{},platform=process.platform,arch=process.arch,openExternal}){
    this.platform=platform;this.arch=arch;this.openExternal=openExternal;
    this.installed=installed;this.appPath=appPath;this.onChange=onChange;this.fetcher=fetcher;this.install=install || (platform==='win32'?launchWindowsInstaller:launchInstaller);this.stage=stage || (platform==='win32'?stageWindowsUpdate:stageUpdate);this.quit=quit;
    this.state={status:'idle',release:null,error:null,checkedAt:null};
  }
  snapshot(){return {...this.state,release:this.state.release && {manual:this.state.release.manual,version:this.state.release.version,tag:this.state.release.tag,notes:this.state.release.notes,size:this.state.release.size}}}
  set(patch){this.state={...this.state,...patch};this.onChange(this.snapshot());return this.snapshot()}
  async check(){
    if(['checking','downloading','installing'].includes(this.state.status)) return this.snapshot();
    this.set({status:'checking',error:null});
    try{const raw=await this.fetcher(releaseUrl,{headers:{'User-Agent':'Pawprint-Updater','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(45_000)});
      if(raw.status===404) return this.set({status:'unreleased',release:null,error:null,checkedAt:Date.now()});
      if(!raw.ok) throw new Error(`GitHub 返回 ${raw.status}`);
      const rawRelease=await raw.json();
      const release=selectRelease(rawRelease,this.installed,this.platform,this.arch);
      return this.set({status:release?'available':newer(rawRelease.tag_name,this.installed)?'unreleased':'current',release,error:null,checkedAt:Date.now()});
    }catch(e){return this.set({status:'error',error:e.message,checkedAt:Date.now()})}
  }
  async installLatest(){
    const release=this.state.release;
    if(this.state.status!=='available'||!release) throw new Error('请先检查新版本。');
    this.set({status:'downloading',error:null,progress:{loaded:0,total:release.size,percent:0}});
    try{const staged=await this.stage(release,this.appPath,{fetcher:this.fetcher,onProgress:progress=>{if(!this.lastProgress || Date.now()-this.lastProgress>200 || progress.percent===100){this.lastProgress=Date.now();this.set({progress});}}});
      this.set({status:'installing'});
      await this.install(this.appPath,staged.ready,staged.root,process.pid,staged.sha256);
      this.quit();return this.snapshot();
    }catch(e){return this.set({status:'error',error:e.name==='TimeoutError' || /timeout/i.test(e.message) ? '下载超时，请重试。' : e.message})}
  }
}
