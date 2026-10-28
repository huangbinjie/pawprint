import {setCodexBackground,readBackgroundMedia} from '../electron/codex-background.mjs';

const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args.includes('--check')){
  const {media,dim}=await readBackgroundMedia(value('--file'),Number(value('--dim')??0));
  console.log(JSON.stringify({ready:true,mime:media.slice(5,media.indexOf(';')),dim}));
}else{
  try{
    const result=await setCodexBackground({file:value('--file'),introFile:value('--intro'),port:Number(value('--port')||9342),dim:Number(value('--dim')??0),restore:args.includes('--restore')});
    console.log(JSON.stringify(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
