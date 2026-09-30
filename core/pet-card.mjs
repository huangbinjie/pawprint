import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {cleanPet} from './multiplayer.mjs';import {companionPersonality} from './personality.mjs';import {CATALOG_VERSION} from './genetics.mjs';
const prefix='pawprint-pet1:',traits=['亲人','活泼','慢悠悠','好奇','爱聊天','夜猫子','有点傲娇','温和慢热'];
export function encodePetCard(pet){
 const card={version:1,genes:CATALOG_VERSION,pet:cleanPet(pet),temperament:companionPersonality(pet).traits};
 const value=prefix+deflateRawSync(Buffer.from(JSON.stringify(card))).toString('base64url');if(value.length>2000)throw Error('访问卡内容太多，无法生成二维码。');return value;
}
export function decodePetCard(value){
 if(typeof value!=='string'||value.length>2000||!value.startsWith(prefix)||!/^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length)))throw Error('这不是有效的 Pawprint 宠物访问卡。');
 let data;try{data=JSON.parse(inflateRawSync(Buffer.from(value.slice(prefix.length),'base64url'),{maxOutputLength:8192}).toString('utf8'));}catch{throw Error('二维码内容已损坏。');}
 if(data.version!==1||data.genes!==CATALOG_VERSION)throw Error('访问卡版本不兼容，请更新 Pawprint。');
 if(!Array.isArray(data.temperament)||data.temperament.length>5||!data.temperament.every(t=>traits.includes(t)))throw Error('访问卡性格信息无效。');
 return {version:1,pet:cleanPet(data.pet),temperament:[...new Set(data.temperament)]};
}
