import React, {useEffect,useRef,useState} from 'react';
import {Circle, Feather, Search, Heart, Trophy, LockKeyhole, Play, X, Armchair, Flower2, Box, Moon, PanelsTopLeft} from 'lucide-react';
import Cat from './Cat.jsx';
import RawText from '../i18n/RawText.jsx';
import {currentLanguage} from '../i18n/locale.js';
import {training,unlockedDecor,unlockedThemes,DAILY_GROWTH} from '../../core/play.mjs';
import {phenotype,TRAITS} from '../../core/genetics.mjs';
import {dayKey,housePets} from '../../core/economy.mjs';
const copy=(en,zh)=>currentLanguage()==='en'?en:zh;
const games={ball:{icon:Circle,en:'Catch the ball',zh:'接球训练'},wand:{icon:Feather,en:'Teaser chase',zh:'逗猫挑战'},hide:{icon:Search,en:'Hide and seek',zh:'捉迷藏'}};
const decor={bed:['Little bed','小床',Armchair],plant:['House plant','绿植',Flower2],ball:['Practice ball','练习球',Circle],wand:['Feather teaser','羽毛逗猫棒',Feather],box:['Hideout box','藏身纸箱',Box],trophy:['Training trophy','训练奖杯',Trophy],cushion:['Soft cushion','软垫',Moon],curtain:['Window curtains','窗帘',PanelsTopLeft]};
const themes={sage:['Sage morning','鼠尾草清晨'],sunset:['Peach sunset','蜜桃晚霞'],night:['Moonlit blue','月光蓝']};
const spots=[['Cardboard box','纸箱'],['House plant','绿植'],['Curtains','窗帘'],['Cushion','软垫'],['Bookshelf','书架'],['Little bed','小床']];
export function DecorGraphic({item}) {
  const color={bed:'#bd907b',plant:'#789574',ball:'#bf8b65',wand:'#ad90b8',box:'#bf9c6e',trophy:'#c8a55b',cushion:'#a3adc6',curtain:'#9baca1'}[item];
  return <svg className={`decor-graphic decor-${item}`} viewBox="0 0 100 90" aria-hidden="true"><g fill={color} stroke="#53614e" strokeWidth="2.5" strokeLinejoin="round">
    {item==='bed'&&<><rect x="12" y="39" width="76" height="33" rx="9"/><path d="M18 72v10m64-10v10"/><rect x="20" y="32" width="27" height="19" rx="7" fill="#f8efde"/><path d="M50 44h30" opacity=".3"/></>}
    {item==='plant'&&<><path d="M33 56h36l-6 26H39Z" fill="#bf9c80"/><path d="M50 58V20" fill="none"/><ellipse cx="37" cy="33" rx="10" ry="20" transform="rotate(-42 37 33)"/><ellipse cx="64" cy="29" rx="10" ry="22" transform="rotate(40 64 29)"/></>}
    {item==='ball'&&<><circle cx="50" cy="55" r="24"/><path d="M28 48q22 21 44 0M50 31q-12 24 0 48" fill="none" opacity=".5"/></>}
    {item==='wand'&&<><path d="M20 81L61 35q22 0 16-20" fill="none"/><path d="M70 12q27 0 17 26q-16 6-17-26Z"/><path d="M73 18l9 16"/></>}
    {item==='box'&&<><path d="M18 37h64v42H18Z"/><path d="M18 37L8 23h33l9 14L60 23h30L82 37" fill="#d6b992"/><path d="M50 40v38" opacity=".35"/></>}
    {item==='trophy'&&<><path d="M32 17h36v25q0 21-18 21T32 42Z"/><path d="M30 25H18q-4 27 17 25m35-25h12q4 27-17 25M50 63v12M33 80h34" fill="none"/><path d="m50 28 3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#fff3c3" stroke="none"/></>}
    {item==='cushion'&&<><rect x="16" y="33" width="68" height="43" rx="16"/><path d="M25 45q25 18 50 0" fill="none" opacity=".4"/></>}
    {item==='curtain'&&<><path d="M13 16h74"/><path d="M18 20h29l-8 54H18Zm35 0h29v54H61Z"/><path d="M25 24v45m11-45-5 45m40-45 5 45" fill="none" opacity=".3"/></>}
  </g></svg>;
}
function Arena({round,pet,command,working,now}) {
  const ref=useRef(null),[aim,setAim]=useState(null),[pointer,setPointer]=useState(null),[dwell,setDwell]=useState(0),sending=useRef(false),hold=useRef(null);
  const remaining=Math.max(0,Math.ceil((round.endsAt-now)/1000)),feedback=round.feedback&&now-round.feedback.at<900?round.feedback:null;
  const tailless=TRAITS.tail[phenotype(pet.genome).tail].absent===true;
  const p=training(pet),expert=p.xp[round.game]>=40,master=p.xp[round.game]>=120;
  const coords=e=>{const b=ref.current.getBoundingClientRect();return {x:(e.clientX-b.left)/b.width*100,y:(e.clientY-b.top)/b.height*100};};
  async function attempt(input){if(sending.current||working||remaining===0)return;sending.current=true;await command({type:'play-attempt',roundId:round.id,...input});sending.current=false;}
  useEffect(()=>{setDwell(0);hold.current=null;},[round.target.at,round.hits,round.attempts]);
  useEffect(()=>{
    if(round.game!=='wand'||!pointer||remaining===0||working)return;
    if(Math.hypot(pointer.x-round.target.x,pointer.y-round.target.y)>10){hold.current=null;setDwell(0);return;}
    const timer=setInterval(()=>{hold.current??=Date.now();const ms=Date.now()-hold.current;setDwell(Math.min(1,ms/round.responseMs));if(ms>=round.responseMs&&!sending.current&&Date.now()-round.lastAttempt>=1100){hold.current=null;void attempt(pointer);}},70);
    return ()=>clearInterval(timer);
  },[pointer?.x,pointer?.y,round.target.at,round.hits,working,remaining]);
  const catPos=round.game==='wand'&&pointer?{x:Math.max(10,Math.min(90,pointer.x-8)),y:Math.max(25,Math.min(72,pointer.y+15))}:feedback?.hit?{x:feedback.x,y:Math.min(76,feedback.y+12)}:{x:18,y:70};
  return <section className="card training-card"><header><div><span className="eyebrow">A TINY PLAY BREAK</span><h2>{copy(games[round.game].en,games[round.game].zh)}</h2></div><div className="round-counters"><span>{remaining}s</span><span>{copy('Catches','成功')} {round.hits}</span></div></header>
    <p>{round.game==='ball'?copy('Drag the ball and release inside the glowing ring. Space or Enter on the ring also throws.','拖动小球，松手投进光圈。也可用空格或回车投球。'):round.game==='wand'?copy('Move the feather into the ring and hold still until your cat pounces. Tap the ring to guide the feather.','把羽毛移进光圈，停留片刻等猫咪扑过来。也可点击光圈引导羽毛。'):copy(tailless?'Find your cat by following the clue. After a few seconds, a tiny paw gives it away.':'Find your cat by following the clue. After a few seconds, a little tail gives it away.',tailless?'根据线索找猫咪。过几秒会露出小爪子。':'根据线索找猫咪。过几秒会露出一小截尾巴。')}</p>
    <div ref={ref} className={`play-arena game-${round.game} ${expert?'expert':''} ${master?'master':''}`} data-testid="play-arena" onPointerMove={e=>{if(round.game==='wand')setPointer(coords(e));if(aim)setAim(coords(e));}} onPointerLeave={()=>{if(round.game==='wand')setPointer(null);}}>
      <div className="arena-window"/><div className="arena-rug"/>
      {round.game!=='hide'&&<><div className={`arena-cat ${feedback?.hit?'caught':''}`} style={{left:`${catPos.x}%`,top:`${catPos.y}%`}}><Cat genome={pet.genome} mood={feedback?.hit?'happy':'idle'} skillId={round.game==='wand'?'chase':undefined}/>{expert&&feedback?.hit&&<span className="catch-flourish">{master?"✦ ✧ ✦":"✦"}</span>}</div><button className="catch-target" style={{left:`${round.target.x}%`,top:`${round.target.y}%`}} aria-label={copy('Catch target','接住目标')} disabled={working||!remaining} onClick={()=>{if(round.game==='wand')setPointer(round.target);else void attempt(round.target);}}><span style={{'--dwell':`${dwell*100}%`}}/></button></>}
      {round.game==='ball'&&<><svg className="throw-guide" viewBox="0 0 100 100" preserveAspectRatio="none">{aim&&<path d={`M 18 76 Q ${(18+aim.x)/2} ${Math.max(4,aim.y-20)} ${aim.x} ${aim.y}`}/>}</svg><button className="throw-ball" aria-label={copy('Throw ball','投球')} style={aim?{left:`${aim.x}%`,top:`${aim.y}%`}:undefined} disabled={working||!remaining} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setAim(coords(e));}} onPointerUp={e=>{if(aim){void attempt(coords(e));setAim(null);}e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>setAim(null)}><Circle size={24}/></button></>}
      {round.game==='wand'&&pointer&&<Feather className="teaser-pointer" size={33} style={{left:`${pointer.x}%`,top:`${pointer.y}%`}}/>}
      {round.game==='hide'&&<div className="hide-spots">{spots.slice(0,round.spots).map((name,i)=><button key={i} aria-label={copy(name[0],name[1])} className={`hide-spot ${feedback?.hit&&feedback.spot===i?'found':''}`} disabled={working||!remaining} onClick={()=>attempt({spot:i})}>{feedback?.hit&&feedback.spot===i?<Cat genome={pet.genome} mood="happy"/>:<DecorGraphic item={['box','plant','curtain','cushion','trophy','bed'][i]}/>}<span>{copy(name[0],name[1])}</span>{now-round.target.at>8000&&round.target.spot===i&&<i className={tailless?"peek-paw":"peek-tail"}/>}</button>)}</div>}
      {feedback&&<div className={`play-feedback ${feedback.hit?'hit':'miss'}`} role="status">{feedback.hit?copy(expert?'Beautiful catch!':'Got it!',expert?'接得漂亮！':'抓到啦！'):copy('Almost! Try again.','差一点，再试试。')}</div>}
    </div>
    {round.game==='hide'&&<div className="hide-clue"><Search size={16}/>{copy(['A rustle of cardboard…','Something behind the leaves…','A tiny wiggle by the window…','A cozy fabric rustle…','A shadow by the shelves…','A sleepy little squeak…'][round.target.spot],['纸板里沙沙响…','叶子后面有动静…','窗边有一小点晃动…','软软的布料在动…','架子边有个小影子…','床边传来小小的呼噜…'][round.target.spot])}</div>}
    <footer><span>{copy('3 catches unlock growth for this round.','本轮成功 3 次即可获得成长。')}</span><button className="text-button" disabled={working} onClick={()=>command({type:'play-finish',roundId:round.id,abandon:remaining>0})}><X size={15}/>{remaining?copy('Leave round','离开本轮'):copy('Save round','保存本轮')}</button></footer>
  </section>;
}
function Room({state,pet,command,working,now}) {
  const room=state.room || {theme:'sage',items:[{item:'bed',x:24,y:72},{item:'plant',x:82,y:52}]},owned=unlockedDecor(state),themesOwned=unlockedThemes(state);
  const [chosen,setChosen]=useState(null),[drag,setDrag]=useState(null),[visit,setVisit]=useState(null),[editing,setEditing]=useState(false),area=useRef(null),moved=useRef(false);
  // Decoration visits are visual companionship, never a source of growth or coins.
  const auto=room.items.length?room.items[Math.floor(now/12000)%room.items.length]:null;
  const destination=visit&&now-visit.at<5000?visit.item:auto;
  const close=pet&&training(pet).bond>=12;
  const position=room.items.find(p=>p.item===destination?.item)||auto;
  const place=e=>{const b=area.current.getBoundingClientRect();return {x:Math.min(95,Math.max(5,(e.clientX-b.left)/b.width*100)),y:Math.min(88,Math.max(25,(e.clientY-b.top)/b.height*100))};};
  return <section className="card room-card"><header><div><span className="eyebrow">MADE WITH LITTLE MEMORIES</span><h2>{copy('Your small room','你们的小房间')}</h2><p>{copy('Earn keepsakes by playing together. Your cat makes itself at home.','一起玩耍解锁纪念品，猫咪会在这里生活。')}</p></div><button className={`button secondary small ${editing?'selected':''}`} onClick={()=>{setEditing(!editing);setChosen(null);}}>{copy(editing?'Done decorating':'Decorate',editing?'布置完成':'布置房间')}</button></header>
    <div ref={area} className={`small-room theme-${room.theme} ${editing?'is-editing':''}`} data-testid="small-room" onClick={e=>{if(editing&&chosen&&!working)void command({type:'room-place',item:chosen,...place(e)});}}><div className="room-wall-window"><span/><span/></div><div className="room-floor"/><div className="room-floor-rug"/>
      {room.items.map(p=><button key={p.item} className={`room-decor ${chosen===p.item?'selected':''}`} style={{left:`${drag?.item===p.item?drag.x:p.x}%`,top:`${drag?.item===p.item?drag.y:p.y}%`}} aria-label={copy(decor[p.item][0],decor[p.item][1])} onClick={e=>{e.stopPropagation();if(editing)setChosen(p.item);else setVisit({item:p,at:Date.now()});}} onPointerDown={e=>{if(!editing||working)return;e.currentTarget.setPointerCapture(e.pointerId);moved.current=false;setDrag({...p});}} onPointerMove={e=>{if(drag?.item===p.item){moved.current=true;setDrag({item:p.item,...place(e)});}}} onPointerUp={e=>{if(drag?.item===p.item){e.currentTarget.releasePointerCapture(e.pointerId);if(moved.current)void command({type:'room-place',item:p.item,...place(e)});setDrag(null);}}} onPointerCancel={()=>setDrag(null)}><DecorGraphic item={p.item}/></button>)}
      {pet&&<div className={`room-pet ${['bed','cushion'].includes(position?.item)?'napping':'playing'}`} style={{left:`${Math.min(86,Math.max(12,(position?.x||50)-8))}%`,top:`${Math.min(75,(position?.y||65)+3)}%`}}><Cat genome={pet.genome} mood="idle" skillId={{bed:'starnap',cushion:'starnap',ball:'ball',box:'box',wand:'chase'}[position?.item]}/>{close&&visit&&now-visit.at<5000&&<span className="room-affection"><Heart size={18}/></span>}</div>}
      {chosen&&editing&&<span className="room-placement-hint">{copy('Click the floor to place it, or drag the item.','点击地板放置，也可以拖动摆设。')}</span>}
    </div>
    {editing&&<div className="room-tools"><div className="decor-shelf">{Object.entries(decor).map(([item,[en,zh,Icon]])=><button key={item} disabled={!owned.includes(item)} className={chosen===item?'selected':''} onClick={()=>setChosen(item)} title={!owned.includes(item)?copy({ball:'Reach 8 ball XP',wand:'Reach 8 teaser XP',box:'Reach 8 hide-and-seek XP',cushion:'Reach 12 bond',curtain:'Reach 40 hide-and-seek XP',trophy:'Reach 40 XP in any game'}[item]||'',{ball:'接球熟练度达到 8',wand:'逗猫熟练度达到 8',box:'捉迷藏熟练度达到 8',cushion:'亲密度达到 12',curtain:'捉迷藏熟练度达到 40',trophy:'任意游戏熟练度达到 40'}[item]||''):undefined}>{owned.includes(item)?<Icon size={20}/>:<LockKeyhole size={17}/>}<span>{copy(en,zh)}</span></button>)}</div><div className="room-theme-picker">{Object.entries(themes).map(([theme,names])=><button key={theme} className={`theme-swatch ${theme} ${room.theme===theme?'selected':''}`} disabled={!themesOwned.includes(theme)} onClick={()=>command({type:'room-theme',theme})} title={copy(...names)} aria-label={copy(...names)}>{!themesOwned.includes(theme)&&<LockKeyhole size={13}/>}</button>)}<span>{copy('Themes unlock at 80 / 200 total XP.','主题在总熟练度 80 / 200 时解锁。')}</span>{chosen&&room.items.some(p=>p.item===chosen)&&<button className="text-button" disabled={working} onClick={()=>command({type:'room-remove',item:chosen})}><X size={14}/>{copy('Put away','收起来')}</button>}</div></div>}
  </section>;
}
export default function PlayRoom({state,command,working,now}) {
  const pets=housePets(state),pet=pets.find(p=>p.id===state.activePetId)||pets[0],round=state.playRound,finishing=useRef(null);
  useEffect(()=>{if(round&&now>=round.endsAt&&!working&&finishing.current!==round.id){finishing.current=round.id;void command({type:'play-finish',roundId:round.id}).then(result=>{if(!result)finishing.current=null;});}},[round?.id,now,working]);
  if(!pet)return <section className="card work-empty"><Heart size={30}/><h2>{copy('A companion makes a room a home.','先迎接一位小屋伙伴。')}</h2><p>{copy('Hatch an egg or bring a cat home from the garden to play together.','孵化一枚蛋，或从后花园接回伙伴，就可以一起玩。')}</p></section>;
  const p=training(pet),remaining=DAILY_GROWTH-(p.daily.date===dayKey(now)?p.daily.count:0),last=p.last;
  return <div className="play-page"><section className="card play-intro"><div><span className="eyebrow">SMALL BREAKS, GROWING FRIENDSHIP</span><h2><RawText>{pet.name}</RawText> · {copy('a little time together','一起玩一会儿')}</h2><p>{copy('Thirty-second games, little keepsakes, and a room that grows with you.','30 秒小游戏、小小纪念品，还有慢慢丰富的小房间。')}</p></div><div className="bond-score"><Heart size={20}/><strong>{p.bond}</strong><span>{copy('Bond','亲密度')}</span></div></section>
    <div className="play-growth-note"><span>{copy(`${remaining} growth rounds left today · 3 catches needed`, `今日还有 ${remaining} 次成长奖励 · 本轮需成功 3 次`)}</span><span>{copy('Keep playing after that, just for fun. No coins are awarded.','之后也可以一直玩，不产出金币。')}</span></div>
    {round&&<Arena round={round} pet={state.pets.find(p=>p.id===round.petId)||pet} command={command} working={working} now={now}/>}
    <div className="game-picker">{Object.entries(games).map(([game,{icon:Icon,en,zh}])=><article className={`card game-choice game-choice-${game}`} key={game}><Icon size={25}/><h3>{copy(en,zh)}</h3><p>{game==='ball'?copy('Aim, throw, and celebrate each catch.','瞄准、投球，庆祝每一次接住。'):game==='wand'?copy('Slow down and let your cat pounce.','停留片刻，等它开心扑过来。'):copy('Follow the clues to a tiny hiding spot.','循着线索，找到小小藏身处。')}</p><div className="game-progress"><span>{copy('Proficiency','熟练度')} {p.xp[game]} / 300</span><span>{copy('Best','最佳')} {p.best[game]}</span><div><i style={{width:`${p.xp[game]/3}%`}}/></div></div><small>{copy(p.xp[game]>=120?'Master companion':p.xp[game]>=40?(game==='hide'?'Extra hiding spots unlocked':'Catch flourish unlocked'):(game==='hide'?'At 40 XP: two more hiding spots':'At 40 XP: catch flourish'),p.xp[game]>=120?'默契高手':p.xp[game]>=40?(game==='hide'?'已解锁更多藏身处':'已解锁花式接球'):(game==='hide'?'40 熟练度解锁两个新藏身处':'40 熟练度解锁花式接球'))}</small><button className="button secondary" disabled={working||!!round&&now<round.endsAt} onClick={()=>command({type:'play-start',petId:pet.id,game})}><Play size={15}/>{copy('Play 30 seconds','玩 30 秒')}</button></article>)}</div>
    
    {!round&&last&&now-last.at<10*60000&&<section className="card round-result" role="status"><Trophy size={23}/><div><h3>{last.abandoned?copy('See you next round.','下次再一起玩。'):copy(`${last.hits} catches · ${games[last.game].en}`,`${last.hits} 次成功 · ${games[last.game].zh}`)}</h3><p>{last.reward?copy(`+${last.gained} proficiency · +4 bond. Check your decoration shelf!`,`熟练度 +${last.gained} · 亲密度 +4，看看有没有新摆设吧！`):last.abandoned?copy('Leaving early uses no daily growth reward.','提前离开不消耗每日成长奖励。'):last.hits<3?copy('Try for 3 catches next time to earn growth.','下次成功 3 次就能获得成长。'):copy('A practice round, just for fun. Growth resets tomorrow.','这轮是开心练习，明天恢复成长奖励。')}</p></div></section>}
    <Room state={state} pet={pet} command={command} working={working} now={now}/>
  </div>;
}
