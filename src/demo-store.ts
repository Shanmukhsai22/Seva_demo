import type { Booking, Consultation, Event, Profile } from './lib';
import { demoEvents } from './demo';

export const DEMO_PASSWORD = 'Demo@12345';
export const DEMO_OTP = '123456';
export const demoAccounts = [
  { id:'demo-admin', name:'Main Ayyagaru', phone:'+919000000001', role:'admin' },
  { id:'demo-ayyagaru', name:'Srinivas Ayyagaru', phone:'+919000000002', role:'ayyagaru' },
  { id:'demo-user', name:'Ananya', phone:'+919000000003', role:'user' },
  { id:'demo-member', name:'Ravi', phone:'+919000000004', role:'user' },
] as const;
type Notice = {id:string; recipient_id:string; kind:string; reference_id:string; status:string; created_at:string};
type State = { version:1; profiles:Profile[]; passwords:Record<string,string>; events:Event[]; consultations:Consultation[]; bookings:(Omit<Booking,'events'> & {user_id:string})[]; notifications:Notice[]; fee:number };
const STORAGE = 'ekatvam-demo-v1'; const SESSION = 'ekatvam-demo-session';
const now = () => new Date().toISOString();
function seed():State {
  const profiles:Profile[]=demoAccounts.map(account=>({...account,language:'en',whatsapp_opt_in:account.role==='user',available:true}));
  const events=demoEvents.map((event,index)=>({...event,id:`demo-event-${index+1}`,starts_at:new Date(Date.now()+(index+7)*86400000).toISOString()}));
  events[1].fee_paise=50100;
  events.push({...structuredClone(events[0]),id:'demo-draft',published:false,starts_at:new Date(Date.now()+14*86400000).toISOString()});
  return {version:1,profiles,passwords:Object.fromEntries(profiles.map(p=>[p.id,DEMO_PASSWORD])),events,fee:0,bookings:[],notifications:[],consultations:[
    {id:'demo-request-active',user_id:'demo-user',notes:'I would like guidance on my career and the year ahead. This is a sample consultation.',status:'assigned',response:null,assigned_to:'demo-ayyagaru',created_at:now(),image_path:'sample-chart',fee_paise:0},
    {id:'demo-request-complete',user_id:'demo-user',notes:'A sample completed consultation, so you can review how guidance appears.',status:'completed',response:'Sample guidance only: take time for reflection and continue your daily prayers. This demonstration does not provide an actual Jatakam reading.',assigned_to:'demo-ayyagaru',created_at:now(),image_path:'sample-chart',fee_paise:0},
    {id:'demo-request-payment',user_id:'demo-user',notes:'Sample paid request. It stays pending while payments are deferred.',status:'awaiting_payment',response:null,assigned_to:null,created_at:now(),image_path:'sample-chart',fee_paise:50000},
  ]};
}
function read():State {
  const stored=localStorage.getItem(STORAGE);
  if(stored){try{const value=JSON.parse(stored);if(value.version===1)return value;}catch{/* Recover only this demo namespace. */}}
  const state=seed();write(state);return state;
}
function write(state:State){try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{throw new Error('demoStorageError');}}
function actor(state:State){const id=sessionStorage.getItem(SESSION);const profile=state.profiles.find(p=>p.id===id);if(!profile)throw new Error('authError');return profile;}
function admin(profile:Profile){if(profile.role!=='admin')throw new Error('forbidden');}
function changed(){window.dispatchEvent(new Event('ekatvam-demo-auth'));}
function signIn(id:string){sessionStorage.setItem(SESSION,id);changed();}
function queue(state:State,kind:string,reference_id:string,recipient_id:string){
  if(!state.profiles.find(p=>p.id===recipient_id)?.whatsapp_opt_in)return;
  if(state.notifications.some(n=>n.kind===kind&&n.reference_id===reference_id&&n.recipient_id===recipient_id))return;
  state.notifications.push({id:crypto.randomUUID(),kind,reference_id,recipient_id,status:'queued',created_at:now()});
}
function assignWaiting(state:State){for(const request of state.consultations.filter(c=>c.status==='pending')){
  const member=state.profiles.find(p=>p.role==='ayyagaru'&&p.available&&!state.consultations.some(c=>c.assigned_to===p.id&&c.status==='assigned'));
  if(!member)break;request.assigned_to=member.id;request.status='assigned';
}}
function withAvailability(state:State,event:Event){return {...event,available:Math.max(0,event.capacity-state.bookings.filter(b=>b.event_id===event.id&&b.status==='confirmed').length)};}
function authError(){return {error:new Error('authError')};}
let pendingPhone:string|null=null;
export const demoAuth = {
  async getSession(){const state=read();const id=sessionStorage.getItem(SESSION);return {data:{session:state.profiles.some(p=>p.id===id)?{access_token:'local-demo-session'}:null}};},
  onAuthStateChange(callback:()=>void){window.addEventListener('ekatvam-demo-auth',callback);return {data:{subscription:{unsubscribe:()=>window.removeEventListener('ekatvam-demo-auth',callback)}}};},
  async signInWithPassword({phone,password}:{phone:string;password:string}){const state=read();const profile=state.profiles.find(p=>p.phone===phone);if(!profile||state.passwords[profile.id]!==password)return authError();signIn(profile.id);return {error:null};},
  async signInWithOtp({phone}:{phone:string;options?:unknown}){if(!read().profiles.some(p=>p.phone===phone))return authError();pendingPhone=phone;return {error:null};},
  async verifyOtp({phone,token}:{phone:string;token:string;type:string}){const profile=read().profiles.find(p=>p.phone===phone);if(!profile||pendingPhone!==phone||token!==DEMO_OTP)return authError();pendingPhone=null;signIn(profile.id);return {error:null};},
  async signUp({phone,password,options}:{phone:string;password:string;options:{data:{name:string;language:string;whatsapp_opt_in:boolean}}}){
    const state=read();if(state.profiles.some(p=>p.phone===phone))return authError();
    const profile:Profile={id:crypto.randomUUID(),phone,role:'user',name:options.data.name,language:options.data.language,whatsapp_opt_in:options.data.whatsapp_opt_in,available:true};
    state.profiles.push(profile);state.passwords[profile.id]=password;write(state);pendingPhone=phone;return {error:null};
  },
  async updateUser({password}:{password:string}){const state=read();const user=actor(state);state.passwords[user.id]=password;write(state);return {error:null};},
  async signOut(){sessionStorage.removeItem(SESSION);pendingPhone=null;changed();return {error:null};},
};
export async function enterDemo(role:Profile['role']){const account=demoAccounts.find(p=>p.role===role)!;signIn(account.id);}

function images():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('ekatvam-demo-images',1);request.onupgradeneeded=()=>request.result.createObjectStore('images');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('demoStorageError'));});}
async function putImage(id:string,file:Blob){const db=await images();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('demoStorageError'));});}finally{db.close();}}
async function getImage(id:string){const db=await images();try{return await new Promise<Blob|undefined>((resolve,reject)=>{const tx=db.transaction('images');const request=tx.objectStore('images').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('demoStorageError'));});}finally{db.close();}}
export async function resetDemo(){
  const db=await images();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').clear();tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('demoStorageError'));});}finally{db.close();}
  write(seed());sessionStorage.removeItem(SESSION);pendingPhone=null;changed();
}
const sampleChart='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="640" viewBox="0 0 600 640"><rect width="600" height="640" fill="#fcf9f3"/><text x="300" y="50" text-anchor="middle" font-family="serif" font-size="25" fill="#84331f">DEMO JATAKAM</text><rect x="60" y="90" width="480" height="480" fill="none" stroke="#b98845" stroke-width="2"/><path d="M60 90L540 570M540 90L60 570M300 90L540 330L300 570L60 330Z" fill="none" stroke="#b98845" stroke-width="2"/><text x="300" y="610" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#81776e">Sample chart — not an actual reading</text></svg>`);

export async function demoApi(path:string,options:RequestInit={}):Promise<any>{
  const state=read();const method=options.method||'GET';
  const body=typeof options.body==='string'?JSON.parse(options.body):{};
  if(path==='/events'&&method==='GET')return state.events.filter(e=>e.published&&new Date(e.starts_at)>new Date()).map(e=>withAvailability(state,e));
  if(path==='/settings')return {consultation_fee_paise:state.fee};
  const user=actor(state);
  if(path==='/me'&&method==='GET')return {...user};
  if(path==='/me'&&method==='PATCH'){
    if(['te','hi','en'].includes(body.language))user.language=body.language;
    user.whatsapp_opt_in=!!body.whatsapp_opt_in;if(user.role!=='user')user.available=!!body.available;
    if(!user.whatsapp_opt_in)state.notifications.filter(n=>n.recipient_id===user.id&&n.status==='queued').forEach(n=>n.status='cancelled');
    assignWaiting(state);write(state);return {...user};
  }
  if(path==='/consultations'&&method==='GET')return state.consultations.filter(c=>user.role==='admin'||(user.role==='ayyagaru'?c.assigned_to===user.id:c.user_id===user.id));
  if(path==='/consultations'&&method==='POST'){
    const form=options.body as FormData;const file=form.get('image') as File;const notes=String(form.get('notes')||'').trim();
    if(!notes||notes.length>4000)throw new Error('noteRequired');
    if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('invalidImage');
    try{const bitmap=await createImageBitmap(file);bitmap.close();}catch{throw new Error('invalidImage');}
    const id=crypto.randomUUID();await putImage(id,file);
    const request:Consultation={id,user_id:user.id,notes,status:state.fee===0?'pending':'awaiting_payment',assigned_to:null,response:null,created_at:now(),image_path:id,fee_paise:state.fee};
    state.consultations.unshift(request);assignWaiting(state);write(state);return request;
  }
  const consultationRoute=path.match(/^\/consultations\/([^/]+)\/(image|complete)$/);
  if(consultationRoute){
    const request=state.consultations.find(c=>c.id===consultationRoute[1]);
    if(!request||!(user.role==='admin'||request.user_id===user.id||(user.role==='ayyagaru'&&request.assigned_to===user.id)))throw new Error('forbidden');
    if(consultationRoute[2]==='image'&&method==='GET'){
      if(request.image_path==='sample-chart')return {url:sampleChart};
      const image=await getImage(request.image_path);if(!image)throw new Error('invalidImage');return {url:URL.createObjectURL(image)};
    }
    if(consultationRoute[2]==='complete'&&method==='POST'){
      if(user.role!=='ayyagaru'||request.assigned_to!==user.id||request.status!=='assigned')throw new Error('forbidden');
      if(typeof body.response!=='string'||!body.response.trim()||body.response.length>10000)throw new Error('noteRequired');
      request.status='completed';request.response=body.response.trim();queue(state,'consultation_completed',request.id,request.user_id);assignWaiting(state);write(state);return {ok:true};
    }
  }
  if(path==='/bookings')return state.bookings.filter(b=>b.user_id===user.id).map(b=>({...b,events:state.events.find(e=>e.id===b.event_id)}));
  const bookingRoute=path.match(/^\/events\/([^/]+)\/book$/);
  if(bookingRoute&&method==='POST'){
    const event=state.events.find(e=>e.id===bookingRoute[1]&&e.published);
    if(!event||new Date(event.starts_at)<=new Date())throw new Error('eventClosed');
    if(state.bookings.some(b=>b.user_id===user.id&&b.event_id===event.id))throw new Error('alreadyBooked');
    if(withAvailability(state,event).available===0)throw new Error('eventFull');
    const booking={id:crypto.randomUUID(),event_id:event.id,user_id:user.id,status:event.fee_paise===0?'confirmed':'awaiting_payment',created_at:now()};
    state.bookings.unshift(booking);if(booking.status==='confirmed')queue(state,'booking_confirmation',booking.id,user.id);write(state);return booking;
  }
  if(path.startsWith('/admin/')){
    admin(user);
    if(path==='/admin/team'&&method==='GET')return state.profiles.filter(p=>p.role==='ayyagaru');
    if(path==='/admin/team'&&method==='POST'){
      const member=state.profiles.find(p=>p.phone===body.phone&&p.role!=='admin');if(!member)throw new Error('memberNotFound');
      member.role='ayyagaru';member.available=true;assignWaiting(state);write(state);return member;
    }
    if(path==='/admin/events'&&method==='GET')return state.events;
    if(path==='/admin/events'&&method==='POST'){
      for(const field of ['title','description','venue'])if(!body[field]||['te','hi','en'].some(lang=>typeof body[field][lang]!=='string'||!body[field][lang].trim()))throw new Error('invalidEvent');
      if(!Number.isInteger(body.fee_paise)||body.fee_paise<0||!Number.isInteger(body.capacity)||body.capacity<1||!Number.isFinite(Date.parse(body.starts_at))||new Date(body.starts_at)<=new Date())throw new Error('invalidEvent');
      const event={...body,id:crypto.randomUUID(),published:false};state.events.unshift(event);write(state);return event;
    }
    const publish=path.match(/^\/admin\/events\/([^/]+)\/publish$/);
    if(publish&&method==='POST'){
      const event=state.events.find(e=>e.id===publish[1]);if(!event||new Date(event.starts_at)<=new Date())throw new Error('eventClosed');
      if(!event.published){event.published=true;state.profiles.forEach(p=>queue(state,'event_announcement',event.id,p.id));write(state);}return {ok:true};
    }
    const assignment=path.match(/^\/admin\/consultations\/([^/]+)\/assign$/);
    if(assignment&&method==='POST'){
      const request=state.consultations.find(c=>c.id===assignment[1]);const member=state.profiles.find(p=>p.id===body.assigned_to&&p.role==='ayyagaru'&&p.available);
      if(!request||!member||!['pending','assigned'].includes(request.status)||state.consultations.some(c=>c.id!==request.id&&c.assigned_to===member.id&&c.status==='assigned'))throw new Error('forbidden');
      request.assigned_to=member.id;request.status='assigned';write(state);return {ok:true};
    }
    if(path==='/admin/settings'&&method==='PATCH'){if(!Number.isInteger(body.consultation_fee_paise)||body.consultation_fee_paise<0)throw new Error('requestFailed');state.fee=body.consultation_fee_paise;write(state);return {consultation_fee_paise:state.fee};}
    if(path==='/admin/notifications')return state.notifications.slice().reverse();
  }
  throw new Error('forbidden');
}
