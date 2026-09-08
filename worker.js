const DEFAULT_STATE={
  version:1,updatedAt:0,
  background:'/default-background.jpg',backgroundMode:'cover',
  home:{name:'A',score:0,color:'#0b63ce',text:'#ffffff',logo:''},
  away:{name:'B',score:0,color:'#d4a800',text:'#111111',logo:''},
  status:'DIRECT',period:'1re MI-TEMPS',running:false,elapsed:0,startedAt:0,
  extraMinutes:0,extraRunning:false,extraElapsed:0,extraStartedAt:0,
  scoreboardVisible:true,message:'',messageVisible:false,
  stats:{possessionHome:50,possessionAway:50,shotsHome:0,shotsAway:0,cornersHome:0,cornersAway:0,foulsHome:0,foulsAway:0},
  cards:[],goals:[],events:[],
  ad:{visible:false,kind:'text',title:'',text:'',image:'',video:'',startedAt:0,duration:0,publicationId:''},
  replay:{visible:false,url:'',startedAt:0,duration:0,speed:1,publicationId:''},
  substitution:{visible:false,out:{name:'',number:'',photo:''},in:{name:'',number:'',photo:''},startedAt:0,duration:12,publicationId:''},
  lineup:{visible:false,team:'home',formation:'4-3-3',players:[],publicationId:''},
  poster:{visible:false,image:'',publicationId:''},
  var:{visible:false,title:'VAR',text:'DÉCISION EN COURS',publicationId:''},
  penalty:{visible:false,home:0,away:0,homeTakers:[],awayTakers:[],publicationId:''},
  live:{enabled:false,hls:'',videoId:'',inputId:''}
};
const TTL=12*60*60*1000, MAX_MEDIA=12*1024*1024;
const clone=x=>JSON.parse(JSON.stringify(x));
const json=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...h}});
function clean(input){const s=clone(DEFAULT_STATE);if(!input||typeof input!=='object')return s;
 const str=(v,n=160)=>String(v??'').slice(0,n), num=(v,min,max,d=0)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):d));
 s.background=typeof input.background==='string'&&input.background.length<2048?input.background:s.background;
 s.backgroundMode=input.backgroundMode==='contain'?'contain':'cover';
 for(const side of ['home','away']){const x=input[side]||{};s[side].name=str(x.name,40)||s[side].name;s[side].score=Math.floor(num(x.score,0,99,0));s[side].color=/^#[0-9a-f]{6}$/i.test(x.color)?x.color:s[side].color;s[side].text=/^#[0-9a-f]{6}$/i.test(x.text)?x.text:s[side].text;s[side].logo=typeof x.logo==='string'&&x.logo.length<2048?x.logo:'';}
 for(const k of ['status','period','message'])if(k in input)s[k]=str(input[k],k==='message'?500:40);
 for(const k of ['running','extraRunning','scoreboardVisible','messageVisible'])if(typeof input[k]==='boolean')s[k]=input[k];
 for(const k of ['elapsed','startedAt','extraMinutes','extraElapsed','extraStartedAt'])s[k]=num(input[k],0,k==='extraMinutes'?99:1e15,0);
 if(input.stats&&typeof input.stats==='object')for(const k of Object.keys(s.stats))s.stats[k]=num(input.stats[k],0,10000,s.stats[k]);
 s.cards=Array.isArray(input.cards)?input.cards.slice(-30).map(c=>({id:str(c.id,80)||crypto.randomUUID(),team:c.team==='away'?'away':'home',player:str(c.player,80),type:['yellow','red','second-yellow'].includes(c.type)?c.type:'yellow',minute:num(c.minute,0,130,0)})):[];
 s.goals=Array.isArray(input.goals)?input.goals.slice(-20).map(g=>({id:str(g.id,80)||crypto.randomUUID(),team:g.team==='away'?'away':'home',player:str(g.player,80),minute:num(g.minute,0,130,0),createdAt:num(g.createdAt,0,1e15,Date.now())})):[];
 s.events=Array.isArray(input.events)?input.events.slice(-60):[];
 for(const key of ['ad','replay','substitution','lineup','poster','var','penalty','live'])if(input[key]&&typeof input[key]==='object')s[key]={...s[key],...input[key]};
 s.ad.duration=num(s.ad.duration,0,180,0);s.ad.startedAt=num(s.ad.startedAt,0,1e15,0);s.ad.visible=!!s.ad.visible;s.ad.kind=['text','image','video'].includes(s.ad.kind)?s.ad.kind:'text';
 s.replay.duration=num(s.replay.duration,0,240,0);s.replay.speed=num(s.replay.speed,.25,1,1);s.replay.visible=!!s.replay.visible;s.replay.startedAt=num(s.replay.startedAt,0,1e15,0);
 s.substitution.visible=!!s.substitution.visible;s.substitution.duration=num(s.substitution.duration,1,60,12);s.substitution.startedAt=num(s.substitution.startedAt,0,1e15,0);
 s.lineup.visible=!!s.lineup.visible;s.lineup.team=s.lineup.team==='away'?'away':'home';s.lineup.players=Array.isArray(s.lineup.players)?s.lineup.players.slice(0,11):[];
 s.poster.visible=!!s.poster.visible;s.var.visible=!!s.var.visible;s.penalty.visible=!!s.penalty.visible;s.live.enabled=!!s.live.enabled;
 s.updatedAt=Date.now();return s;
}
async function state(env){const r=await env.DB.prepare('SELECT state_json FROM app_state WHERE id=1').first();return r?clean(JSON.parse(r.state_json)):clone(DEFAULT_STATE)}
async function save(env,s){const c=clean(s);await env.DB.prepare('INSERT INTO app_state(id,state_json,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').bind(JSON.stringify(c),Date.now()).run();return c}
async function valid(env,t){if(!t)return false;const r=await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token=?').bind(String(t)).first();return !!r&&Number(r.expires_at)>Date.now()}
function auth(req){return req.headers.get('x-admin-token')||new URL(req.url).searchParams.get('token')||''}
async function requireAdmin(req,env){return valid(env,auth(req))}
async function room(env){return env.ROOM.get(env.ROOM.idFromName('global'))}
async function broadcast(env,s){try{await (await room(env)).fetch('https://room/broadcast',{method:'POST',body:JSON.stringify(s)})}catch(e){console.log('broadcast',e.message)}}
async function config(env){const r=await env.DB.prepare('SELECT live_input_id FROM stream_config WHERE id=1').first();return String(env.CLOUDFLARE_STREAM_LIVE_INPUT_ID||r?.live_input_id||'').trim()}
async function cf(env,path,init={}){const a=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim(),t=String(env.CLOUDFLARE_STREAM_API_TOKEN||'').trim();if(!a||!t)throw new Error('Configurez CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_STREAM_API_TOKEN.');const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(a)}${path}`,{...init,headers:{Authorization:`Bearer ${t}`,'content-type':'application/json',...(init.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false)throw new Error(d?.errors?.[0]?.message||'Erreur Cloudflare Stream');return d.result}
async function liveInfo(env){const id=await config(env);if(!id)throw new Error('Aucun Live Input configuré. Créez-le depuis l’Admin.');const videos=await cf(env,`/stream/live_inputs/${encodeURIComponent(id)}/videos`);const live=(videos||[]).find(v=>v?.status?.state==='live-inprogress'||v?.live===true);if(!live?.uid||!live?.playback?.hls)throw new Error('Aucun direct actif sur le Live Input.');return {inputId:id,videoId:live.uid,hls:live.playback.hls}}
function hlsDuration(m){return String(m).split(/\r?\n/).reduce((n,l)=>n+(Number((/^#EXTINF:([0-9.]+)/.exec(l)||[])[1])||0),0)}
async function replay(env,before,after){if(after)await new Promise(r=>setTimeout(r,after*1000));const i=await liveInfo(env);const p=await fetch(`${i.hls}${i.hls.includes('?')?'&':'?'}duration=60s`,{cache:'no-store'});if(!p.ok)throw new Error('Buffer DVR indisponible.');const manifest=await p.text(), start=Number(p.headers.get('preview-start-seconds')),mediaId=p.headers.get('stream-media-id')||i.videoId,d=hlsDuration(manifest);if(!Number.isFinite(start)||!d)throw new Error('Position du direct indisponible.');const edge=start+d,duration=Math.min(60,before+after),clipStart=Math.max(0,edge-duration),origin=new URL(i.hls).origin;return {url:`${origin}/${mediaId}/manifest/clip.m3u8?time=${clipStart.toFixed(3)}s&duration=${duration.toFixed(3)}s`,duration,videoId:mediaId}}
export class Room{constructor(ctx,env){this.ctx=ctx;this.env=env;this.sockets=new Set()}async fetch(req){const u=new URL(req.url);if(u.pathname==='/connect'){if(req.headers.get('Upgrade')!=='websocket')return new Response('Upgrade required',{status:426});const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();this.sockets.add(server);server.addEventListener('close',()=>this.sockets.delete(server));server.addEventListener('error',()=>this.sockets.delete(server));const current=await this.ctx.storage.get('state');server.send(JSON.stringify({type:'state',state:current||DEFAULT_STATE}));return new Response(null,{status:101,webSocket:client})}if(u.pathname==='/broadcast'&&req.method==='POST'){const s=await req.json();await this.ctx.storage.put('state',s);const msg=JSON.stringify({type:'state',state:s});for(const ws of this.sockets){try{ws.send(msg)}catch{this.sockets.delete(ws)}}return new Response('ok')}return new Response('not found',{status:404})}}
export default{async fetch(req,env){const u=new URL(req.url);try{
 if(u.pathname==='/ws')return (await room(env)).fetch('https://room/connect',{headers:{Upgrade:req.headers.get('Upgrade')||''}});
 if(u.pathname==='/api/state'&&req.method==='GET')return json(await state(env));
 if(u.pathname==='/api/auth'&&req.method==='POST'){const b=await req.json();if(!env.ADMIN_PASSWORD)return json({error:'ADMIN_PASSWORD non configuré'},500);if(String(b.password||'')!==String(env.ADMIN_PASSWORD))return json({ok:false,error:'Mot de passe incorrect'},401);const token=crypto.randomUUID();await env.DB.prepare('INSERT INTO admin_sessions(token,expires_at) VALUES(?,?)').bind(token,Date.now()+TTL).run();return json({ok:true,token,expiresAt:Date.now()+TTL})}
 if(u.pathname==='/api/state'&&req.method==='POST'){if(!(await requireAdmin(req,env)))return json({error:'Session invalide'},401);const b=await req.json(),s=await save(env,b.state);await broadcast(env,s);return json({ok:true,state:s})}
 if(u.pathname==='/api/media'&&req.method==='POST'){if(!(await requireAdmin(req,env)))return json({error:'Session invalide'},401);const f=await req.formData(),file=f.get('file');if(!(file instanceof File))return json({error:'Fichier manquant'},400);if(file.size>MAX_MEDIA)return json({error:'Fichier limité à 12 Mo'},413);const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO media_files(id,mime,size,data,created_at) VALUES(?,?,?,?,?)').bind(id,file.type||'application/octet-stream',file.size,await file.arrayBuffer(),Date.now()).run();return json({ok:true,url:`/media/${id}`})}
 if(u.pathname.startsWith('/media/')&&req.method==='GET'){const id=u.pathname.split('/').pop(),r=await env.DB.prepare('SELECT mime,size,data FROM media_files WHERE id=?').bind(id).first();if(!r)return new Response('Introuvable',{status:404});return new Response(r.data,{headers:{'content-type':r.mime,'content-length':String(r.size),'cache-control':'public,max-age=31536000,immutable'}})}
 if(u.pathname==='/api/live/input'&&req.method==='POST'){if(!(await requireAdmin(req,env)))return json({error:'Session invalide'},401);const b=await req.json();const result=await cf(env,'/stream/live_inputs',{method:'POST',body:JSON.stringify({meta:{name:String(b.name||'DJIBABOUYA TV LIVE')},enabled:true,preferLowLatency:true,recording:{mode:'automatic',timeoutSeconds:0,allowedOrigins:[]}})});await env.DB.prepare('INSERT INTO stream_config(id,live_input_id,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET live_input_id=excluded.live_input_id,updated_at=excluded.updated_at').bind(result.uid,Date.now()).run();return json({ok:true,input:result})}
 if(u.pathname==='/api/live/status'&&req.method==='GET'){try{return json({ok:true,...await liveInfo(env)})}catch(e){return json({ok:false,error:e.message})}}
 if(u.pathname==='/api/live/replay'&&req.method==='POST'){if(!(await requireAdmin(req,env)))return json({error:'Session invalide'},401);const b=await req.json(),before=Math.max(1,Math.min(45,Number(b.before)||10)),after=Math.max(0,Math.min(15,Number(b.after)||3)),r=await replay(env,before,after);return json({ok:true,...r})}
 return env.ASSETS.fetch(req);
 }catch(e){console.error(e);return json({ok:false,error:e.message||'Erreur serveur'},500)}}};
