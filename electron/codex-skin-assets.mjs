import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const base='https://github.com/huangbinjie/pawprint/releases/download/skin-assets-v1';
export const SKIN_FILES={
 'night-idle':{size:6567017,sha256:'b5a06196dbc768079ba29f076fabbf0574e8ca9f00b357ba29a1ba88289213bc'},
 'night-intro':{size:10996366,sha256:'e047816a615f97eb1ce46569425ede5b9e1e15f93f350a3ef5ae08b8d6be6615'},
 'cat-idle':{size:8355861,sha256:'9742ebbcc4ac39e57aa1a9bcb83bf6c0220c48522eb759580b5ffa79da0a3273'},
 'cat-idle-v2':{size:2965223,sha256:'39af99b6357fc7762cd3cf7f454f5c757f7338b8c5344f096c335f23ea95f604'},
 'dog-idle':{size:4353472,sha256:'45ea22b1a0bf337dc005d5c0d02d84fba465473a105fff5df942b05813d416f7'},
};

export async function ensureSkinFile(id,directory,{fetcher=fetch,onProgress=()=>{},manifest=SKIN_FILES}={}){
 const expected=Object.hasOwn(manifest,id)?manifest[id]:null;if(!expected)throw Error('无效的皮肤资源。');
 await mkdir(directory,{recursive:true});const file=path.join(directory,id+'.mp4');
 let cached=false;
 try{
  if((await stat(file)).size===expected.size){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);cached=hash.digest('hex')===expected.sha256;}
 }catch(error){if(error.code!=='ENOENT')throw error;}
 if(cached){onProgress(expected.size,expected.size);return file;}
 const partial=file+'.part';let loaded=0;const hash=createHash('sha256');
 try{
  const response=await fetcher(`${base}/${id}.mp4`,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error('皮肤下载失败，请稍后重试。');
  const final=new URL(response.url||`${base}/${id}.mp4`);
  if(final.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(final.hostname))throw Error('皮肤下载来源无效。');
  const meter=new Transform({transform(chunk,_encoding,done){loaded+=chunk.length;if(loaded>expected.size){done(Error('皮肤文件大小不匹配。'));return;}hash.update(chunk);onProgress(loaded,expected.size);done(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(partial,{mode:0o600}));
  if(loaded!==expected.size||hash.digest('hex')!==expected.sha256)throw Error('皮肤校验失败，请重新下载。');
  await rename(partial,file);return file;
 }finally{await rm(partial,{force:true});}
}
