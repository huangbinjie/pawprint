import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const RELEASE_REPO = 'huangbinjie/pawprint';
const releaseUrl = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const zipName = version => `Pawprint-${version}-mac-arm64.zip`;
const hashName = version => `${zipName(version)}.sha256`;
const parse = value => { const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || ''); return m ? m.slice(1).map(Number) : null; };
export function newer(candidate, installed) {
  const a=parse(candidate),b=parse(installed);
  if (!a || !b) return false;
  for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]>b[i];
  return false;
}
export function selectRelease(release, installed) {
  if (!release || release.draft || release.prerelease || !newer(release.tag_name,installed)) return null;
  const version=release.tag_name.replace(/^v/,'');
  const zip=release.assets?.find(a=>a.name===zipName(version));
  const checksum=release.assets?.find(a=>a.name===hashName(version));
  if(!zip || !checksum || zip.size<100_000 || zip.size>800_000_000) return null;
  for(const asset of [zip,checksum]) {
    const u=new URL(asset.browser_download_url);
    if(u.protocol!=='https:' || u.hostname!=='github.com' || !u.pathname.startsWith(`/${RELEASE_REPO}/releases/download/`)) return null;
  }
  return {version,tag:release.tag_name,notes:release.body?.slice(0,3000)||'',zip:zip.browser_download_url,checksum:checksum.browser_download_url,size:zip.size};
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
export async function verifiedDownload(release, directory, fetcher=fetch) {
  const filename=zipName(release.version);
  const expected=checksumFrom(await (await response(release.checksum,fetcher)).text(),filename);
  // The abort signal remains active while the entire 100+ MB body streams.
  const r=await response(release.zip,fetcher,10 * 60_000);
  if(!r.body) throw new Error('下载包为空。');
  const target=path.join(directory,filename);
  await pipeline(Readable.fromWeb(r.body),createWriteStream(target,{flags:'wx'}));
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
export async function stageUpdate(release,currentApp,{fetcher=fetch,workArea=tmpdir()}={}) {
  if(process.platform!=='darwin') throw new Error('目前只支持 Apple 芯片 Mac 更新。');
  const root=await mkdtemp(path.join(workArea,'pawprint-update-'));
  const staged=path.join(root,'Pawprint.app');
  try{
    const archive=await verifiedDownload(release,root,fetcher);
    await run('/usr/bin/ditto',['-x','-k',archive,root],{timeout:180_000});
    if(!(await lstat(staged)).isDirectory()) throw new Error('安装包缺少 Pawprint.app。');
    if(await bundleValue(staged,'CFBundleIdentifier')!=='studio.binmax.pawprint') throw new Error('安装包应用标识不匹配。');
    if(await bundleValue(staged,'CFBundleShortVersionString')!==release.version) throw new Error('安装包版本不匹配。');
    const ready=path.join(path.dirname(currentApp),`.Pawprint-new-${randomUUID()}.app`);
    await run('/usr/bin/ditto',[staged,ready],{timeout:180_000});
    return {root,ready};
  }catch(e){await rm(root,{recursive:true,force:true});throw e}
}
export function launchInstaller(currentApp,ready,root,pid) {
  // All arguments are local paths we created; the script waits until the running app exits.
  const script=path.join(process.resourcesPath,'updater/install-update.sh');
  const child=spawn('/bin/sh',[script,currentApp,ready,root,String(pid)],{detached:true,stdio:'ignore'});
  child.unref();
}
export class UpdateService {
  constructor({installed,appPath,onChange=()=>{},fetcher=fetch,install=launchInstaller,quit=()=>{}}){
    this.installed=installed;this.appPath=appPath;this.onChange=onChange;this.fetcher=fetcher;this.install=install;this.quit=quit;
    this.state={status:'idle',release:null,error:null,checkedAt:null};
  }
  snapshot(){return {...this.state,release:this.state.release && {version:this.state.release.version,tag:this.state.release.tag,notes:this.state.release.notes,size:this.state.release.size}}}
  set(patch){this.state={...this.state,...patch};this.onChange(this.snapshot());return this.snapshot()}
  async check(){
    if(this.state.status==='downloading'||this.state.status==='installing') return this.snapshot();
    this.set({status:'checking',error:null});
    try{const raw=await this.fetcher(releaseUrl,{headers:{'User-Agent':'Pawprint-Updater','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(45_000)});
      if(raw.status===404) return this.set({status:'unreleased',release:null,error:null,checkedAt:Date.now()});
      if(!raw.ok) throw new Error(`GitHub 返回 ${raw.status}`);
      const release=selectRelease(await raw.json(),this.installed);
      return this.set({status:release?'available':'current',release,error:null,checkedAt:Date.now()});
    }catch(e){return this.set({status:'error',error:e.message,checkedAt:Date.now()})}
  }
  async installLatest(){
    const release=this.state.release;
    if(this.state.status!=='available'||!release) throw new Error('请先检查新版本。');
    this.set({status:'downloading',error:null});
    try{const staged=await stageUpdate(release,this.appPath,{fetcher:this.fetcher});
      this.set({status:'installing'});
      this.install(this.appPath,staged.ready,staged.root,process.pid);
      this.quit();return this.snapshot();
    }catch(e){return this.set({status:'error',error:e.name==='TimeoutError' || /timeout/i.test(e.message) ? '下载超时，请重试。' : e.message})}
  }
}
