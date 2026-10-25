import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, MapPin, ShieldCheck, Sparkles, Sun, Menu, X, ChevronRight, UploadCloud, Users, Bell, Check, LogOut, ArrowUpRight, Flower2, BookOpen, HeartHandshake } from 'lucide-react';
import { dictionaries, initialLanguage, languages, locales, type Language, type TranslationKey } from './i18n';
import { api, authClient, demoMode, type Profile, type Event, type Consultation, type Booking } from './lib';
import { DEMO_PASSWORD, demoAccounts, enterDemo, resetDemo } from './demo-store';

type T = (key: TranslationKey) => string;
function Modal({ children, title, close, closeLabel }: { children: ReactNode; title: string; close: () => void; closeLabel: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label={closeLabel}><X size={22}/></button></div>{children}</dialog>;
}
const phoneNumber = (value: string) => `+91${value.replace(/\D/g, '').slice(-10)}`;
const validPhone = (value: string) => /^[6-9]\d{9}$/.test(value.replace(/\D/g, ''));

function Auth({ t, language, close, done }: { t: T; language: Language; close: () => void; done: () => void }) {
  const [mode, setMode] = useState<'password' | 'register' | 'otp' | 'reset'>('password');
  const [stage, setStage] = useState<'details' | 'verify' | 'newPassword'>('details');
  const [phone, setPhone] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState(''); const [optIn, setOptIn] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null); const [message, setMessage] = useState<TranslationKey | null>(null); const [busy, setBusy] = useState(false);
  const switchMode = (next: typeof mode) => { setMode(next); setStage('details'); setError(null); setMessage(null); setPassword(''); setOtp(''); };
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setMessage(null);
    if (!authClient) return setError('setupRequired');
    if (!validPhone(phone)) return setError('invalidPhone');
    if ((mode === 'register' || mode === 'password' || stage === 'newPassword') && password.length < 10) return setError('invalidPassword');
    if (mode === 'register' && !name.trim()) return setError('invalidName');
    if (stage === 'verify' && !/^\d{6}$/.test(otp)) return setError('invalidOtp');
    setBusy(true);
    try {
      if (stage === 'newPassword') {
        const result = await authClient.updateUser({ password }); if (result.error) throw result.error;
        setMessage('passwordSaved'); done(); return;
      }
      if (stage === 'verify') {
        const result = await authClient.verifyOtp({ phone: phoneNumber(phone), token: otp, type: 'sms' }); if (result.error) throw result.error;
        if (mode === 'reset') { setPassword(''); setStage('newPassword'); } else done();
      } else if (mode === 'password') {
        const result = await authClient.signInWithPassword({ phone: phoneNumber(phone), password }); if (result.error) throw result.error; done();
      } else {
        const result = mode === 'register'
          ? await authClient.signUp({ phone: phoneNumber(phone), password, options: { data: { name: name.trim(), language, whatsapp_opt_in: optIn } } })
          : await authClient.signInWithOtp({ phone: phoneNumber(phone), options: { shouldCreateUser: false } });
        if (result.error) throw result.error;
        setStage('verify'); setMessage(demoMode ? 'demoOtpHelp' : 'otpSent');
      }
    } catch { setError('authError'); } finally { setBusy(false); }
  }
  return <Modal title={t(stage === 'newPassword' || mode === 'reset' ? 'reset' : 'signinTitle')} close={close} closeLabel={t('close')}>
    <p className="muted">{t('signinBody')}</p>
    {demoMode && <div className="demo-accounts"><strong>{t('demoTitle')}</strong><p>{t('demoHint')}</p><div className="demo-account-buttons">{(['admin','user','ayyagaru'] as const).map(role => <button type="button" className="button secondary small" key={role} disabled={busy} onClick={() => { setBusy(true); void enterDemo(role).then(done).catch(() => setError('demoStorageError')).finally(() => setBusy(false)); }}>{t(role === 'admin' ? 'demoAdmin' : role === 'user' ? 'demoUser' : 'demoAyyagaru')}</button>)}</div><details><summary>{t('demoAccounts')}</summary>{demoAccounts.map(account => <p key={account.id}>{account.name}: <code>{account.phone.slice(3)}</code></p>)}<p>{t('password')}: <code>{DEMO_PASSWORD}</code></p></details></div>}
    {!authClient && <div className="notice">{t('setupRequired')}</div>}
    <div className="tabs">{(['password', 'otp', 'register'] as const).map(m => <button key={m} onClick={() => switchMode(m)} className={mode === m ? 'active' : ''}>{t(m === 'password' ? 'passwordLogin' : m === 'otp' ? 'otpLogin' : 'register')}</button>)}</div>
    <form onSubmit={submit} className="form-stack">
      {mode === 'register' && stage === 'details' && <label>{t('name')}<input autoComplete="name" value={name} maxLength={100} onChange={e => setName(e.target.value)} required/></label>}
      {stage !== 'newPassword' && <label>{t('phone')}<div className="phone-input"><span>+91</span><input type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} maxLength={10} disabled={stage === 'verify'} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} required/></div><small>{t('phoneHelp')}</small></label>}
      {((stage === 'details' && ['register', 'password'].includes(mode)) || stage === 'newPassword') && <label>{t(stage === 'newPassword' ? 'newPassword' : 'password')}<input type="password" autoComplete={mode === 'password' ? 'current-password' : 'new-password'} value={password} minLength={10} onChange={e => setPassword(e.target.value)} required/><small>{t('passwordHelp')}</small></label>}
      {stage === 'verify' && <label>{t('otp')}<input inputMode="numeric" autoComplete="one-time-code" value={otp} maxLength={6} pattern="[0-9]{6}" onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} required/><small>{t(demoMode ? 'demoOtpHelp' : 'otpHelp')}</small></label>}
      {mode === 'register' && stage === 'details' && <label className="checkbox"><input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)}/><span>{t('whatsapp')}</span></label>}
      {error && <p className="error" role="alert">{t(error)}</p>}{message && <p className="success" role="status">{t(message)}</p>}
      <button className="button full-width" disabled={busy || !authClient}>{busy ? t('loading') : t(stage === 'newPassword' ? 'savePassword' : stage === 'verify' ? 'verify' : mode === 'password' ? 'login' : 'sendOtp')}<ArrowRight size={18}/></button>
    </form>
    {mode === 'password' && <button className="text-button centered" onClick={() => switchMode('reset')}>{t('forgot')}</button>}
    {stage === 'verify' && <button className="text-button centered" onClick={() => { setStage('details'); setOtp(''); setMessage(null); }}>{t('back')}</button>}
    <p className="fine-print">{t('consentNote')}</p>
  </Modal>;
}

function Ornament({ className = '' }: { className?: string }) {
  return <svg className={`ornament ${className}`} viewBox="0 0 400 400" fill="none" aria-hidden="true"><circle cx="200" cy="200" r="177"/><circle cx="200" cy="200" r="160"/><circle cx="200" cy="200" r="114"/>{Array.from({ length: 16 }, (_, i) => <g key={i} transform={`rotate(${i * 22.5} 200 200)`}><path d="M200 30 Q245 108 200 151 Q155 108 200 30Z"/><path d="M200 16 L205 27 L200 38 L195 27Z"/><path d="M200 156 Q225 184 200 199 Q175 184 200 156Z"/></g>)}</svg>;
}

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage); const t: T = key => dictionaries[language][key];
  const [page, setPage] = useState(location.hash.slice(1) || 'home'); const [mobileNav, setMobileNav] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null); const [auth, setAuth] = useState(false); const [privacy, setPrivacy] = useState(false);
  const [events, setEvents] = useState<Event[]>([]); const [selectedEvent, setSelectedEvent] = useState<Event | null>(null); const [ticket, setTicket] = useState<Booking | null>(null);
  const [jatakamImage, setJatakamImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<TranslationKey | null>(null); const [notice, setNotice] = useState<TranslationKey | null>(null); const [loadingEvents, setLoadingEvents] = useState(!!authClient);
  const [consultations, setConsultations] = useState<Consultation[]>([]); const [bookings, setBookings] = useState<Booking[]>([]); const [team, setTeam] = useState<Profile[]>([]); const [notifications, setNotifications] = useState<{id:string;status:string;kind:string;created_at:string}[]>([]);
  const [consultationFee, setConsultationFee] = useState<number | null>(null);
  const navigate = (next: string) => { location.hash = next; setMobileNav(false); setError(null); setNotice(null); };
  const content = (value: Record<string, string>) => value[language] || value.en;
  const date = (value: string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locales[language], { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric', ...options }).format(new Date(value));
  const money = (paise: number) => paise === 0 ? t('free') : new Intl.NumberFormat(locales[language], { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
  const status = (value: string) => value in dictionaries.en ? t(value as TranslationKey) : t('pending');
  function showError(err: unknown) { const message = err instanceof Error ? err.message : ''; setError(message in dictionaries.en ? message as TranslationKey : 'requestFailed'); }
  async function loadEvents() {
    if (!authClient) return;
    setLoadingEvents(true);
    try { const [items, settings] = await Promise.all([api('/events'), api('/settings')]); setEvents(items); setConsultationFee(settings.consultation_fee_paise); } catch (err) { showError(err); } finally { setLoadingEvents(false); }
  }
  async function loadProfile() {
    if (!authClient) return;
    const session = (await authClient.getSession()).data.session;
    if (!session) { setProfile(null); setConsultations([]); setBookings([]); setTeam([]); setNotifications([]); return; }
    try { const value = await api('/me'); setProfile(value); } catch (err) { showError(err); }
  }
  async function loadWorkspace() {
    if (!profile) return;
    setBusy(true);
    try {
      const [requests, bookingsData] = await Promise.all([api('/consultations'), api('/bookings')]); setConsultations(requests); setBookings(bookingsData);
      if (profile.role === 'admin') { const [members, queue] = await Promise.all([api('/admin/team'), api('/admin/notifications')]); setTeam(members); setNotifications(queue); }
    } catch (err) { showError(err); } finally { setBusy(false); }
  }
  useEffect(() => {
    document.documentElement.lang = language; document.title = `${dictionaries[language].brand} · Ekatvam Seva`;
    try { localStorage.setItem('ekatvam-language', language); } catch { /* Optional browser persistence. */ }
  }, [language]);
  useEffect(() => {
    const listener = () => { setPage(location.hash.slice(1) || 'home'); window.scrollTo({ top: 0, behavior: 'instant' }); };
    window.addEventListener('hashchange', listener); void loadEvents(); void loadProfile();
    // Use a timer so Supabase's callback does not await another auth operation under its lock.
    const subscription = authClient?.onAuthStateChange(() => { setTimeout(() => { void loadProfile(); if(demoMode) void loadEvents(); }, 0); });
    return () => { window.removeEventListener('hashchange', listener); subscription?.data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { if (page === 'dashboard' && profile) void loadWorkspace(); }, [page, profile?.id, profile?.role]);
  useEffect(() => () => { if(jatakamImage?.startsWith('blob:')) URL.revokeObjectURL(jatakamImage); }, [jatakamImage]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(null); setNotice(null); try { await action(); } catch (err) { showError(err); } finally { setBusy(false); } }
  const requireLogin = () => { if (!profile) { setAuth(true); return false; } return true; };
  async function bookEvent(event: Event) {
    if (!requireLogin()) return;
    await run(async () => { const result = await api(`/events/${event.id}/book`, { method: 'POST' }); setNotice(result.status === 'confirmed' ? 'booked' : 'bookingPending'); setSelectedEvent(null); navigate('dashboard'); setNotice(result.status === 'confirmed' ? 'booked' : 'bookingPending'); await loadWorkspace(); await loadEvents(); });
  }
  const eventCards = (items: Event[]) => <div className="event-grid">{items.map((event, index) => <article className="event-card" key={event.id}>
    <button className={`event-art event-art-${index % 2}`} onClick={() => setSelectedEvent(event)} aria-label={`${t('viewDetails')}: ${content(event.title)}`}><Ornament/><div className="event-art-icon">{index % 2 ? <Flower2 size={68} strokeWidth={.8}/> : <Sun size={68} strokeWidth={.8}/>}</div><span className="event-date"><strong>{date(event.starts_at, {day:'2-digit',month:undefined,year:undefined})}</strong>{date(event.starts_at, {day:undefined,month:'short',year:undefined})}</span><span className="event-type">{t('brand')}</span></button>
    <div className="event-card-body"><p className="event-meta"><MapPin size={14}/>{content(event.venue)}</p><h3>{content(event.title)}</h3><p>{content(event.description)}</p><div className="event-card-bottom"><span>{money(event.fee_paise)}</span><button className="text-button" onClick={() => setSelectedEvent(event)}>{t('viewDetails')}<ArrowUpRight size={17}/></button></div></div>
  </article>)}</div>;
  const requestCard = (request: Consultation, canManage = false) => <article className="request-card" key={request.id}>
    <div className="row between"><span className={`badge ${request.status}`}>{status(request.status)}</span><small>{date(request.created_at)}</small></div><p className="request-note">{request.notes}</p><small className="muted">{t('bookingId')}: {request.id.slice(0, 8)}</small>
    {canManage && profile?.role === 'admin' && <p className="muted">{t('assignedTo')}: {team.find(member => member.id === request.assigned_to)?.name || t('none')}</p>}
    <button className="text-button" onClick={() => void run(async () => { const result = await api(`/consultations/${request.id}/image`); setJatakamImage(result.url); })}>{t('viewImage')}<ArrowUpRight size={15}/></button>
    {request.response && <div className="response"><strong>{t('response')}</strong><p>{request.response}</p></div>}
    {canManage && profile?.role === 'admin' && request.status !== 'completed' && request.status !== 'awaiting_payment' && <form className="inline-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => { await api(`/admin/consultations/${request.id}/assign`, { method:'POST',body:JSON.stringify({assigned_to:data.get('assigned_to')}) }); await loadWorkspace(); }); }}><select name="assigned_to" aria-label={t('assignedTo')} defaultValue={request.assigned_to || ''} required><option value="" disabled>{t('unassigned')}</option>{team.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button className="button small" disabled={busy}>{t('assign')}</button></form>}
    {canManage && request.assigned_to === profile?.id && request.status === 'assigned' && <form className="form-stack" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => { await api(`/consultations/${request.id}/complete`, {method:'POST', body:JSON.stringify({response:data.get('response')})}); await loadWorkspace(); }); }}><label>{t('writeResponse')}<textarea name="response" required maxLength={10000}/></label><button className="button small" disabled={busy}>{t('complete')}</button></form>}
  </article>;
  return <>
    <div className="topline"><span><Sparkles size={12}/>{t('tagline')}</span><label className="language-picker"><span className="sr-only">{t('chooseLanguage')}</span><select value={language} onChange={e => setLanguage(e.target.value as Language)}>{Object.entries(languages).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <header className="header"><a href="#home" className="brand"><span className="brand-symbol"><Flower2 size={34} strokeWidth={1.15}/></span><span><strong>{t('brand')}</strong><small>EKATVAM SEVA</small></span></a><nav className={mobileNav ? 'nav open' : 'nav'} aria-label={t('home')}>{(['home','consultations','events'] as const).map(item => <a href={`#${item}`} key={item} onClick={() => setMobileNav(false)} className={page === item ? 'current' : ''}>{t(item)}</a>)}{profile && <a href="#dashboard" onClick={() => setMobileNav(false)} className={page === 'dashboard' ? 'current' : ''}>{t('dashboard')}</a>}</nav><div className="header-actions">{profile ? <button className="icon-button" aria-label={t('logout')} onClick={() => void authClient?.signOut().then(() => navigate('home'))}><LogOut size={20}/></button> : <button className="button small" onClick={() => setAuth(true)}>{t('login')}<ArrowUpRight size={15}/></button>}<button className="icon-button mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label={mobileNav ? t('close') : t('home')} aria-expanded={mobileNav}>{mobileNav ? <X/> : <Menu/>}</button></div></header>
    {demoMode && <div className="preview-bar demo-toolbar"><span>{t('demoBadge')}</span><div><button onClick={() => setAuth(true)}>{t('demoAccounts')}</button><button disabled={busy} onClick={() => { if(window.confirm(t('demoResetConfirm'))) void run(async () => { await resetDemo(); setProfile(null);setConsultations([]);setBookings([]);setTeam([]);setNotifications([]);setSelectedEvent(null);setTicket(null);setJatakamImage(null);await loadEvents();navigate('home');setNotice('demoResetDone'); }); }}>{t('demoReset')}</button></div></div>}
    <main>
      {(error || notice) && <div className="container feedback" role={error ? 'alert' : 'status'}><div className={error ? 'error' : 'success'}>{t((error || notice)!)}<button className="icon-button" onClick={() => { setError(null); setNotice(null); }} aria-label={t('close')}><X size={16}/></button></div></div>}
      {page === 'home' && <>
        <section className="hero"><div className="hero-copy"><span className="eyebrow"><span/>{t('eyebrow')}</span><h1>{t('heroTitle')}</h1><p>{t('heroBody')}</p><div className="hero-actions"><button className="button" onClick={() => navigate('consultations')}>{t('heroCta')}<ArrowUpRight size={18}/></button><button className="button secondary" onClick={() => navigate('events')}>{t('explore')}<ArrowRight size={18}/></button></div><div className="hero-assurance"><ShieldCheck size={17}/><span>{t('secure')}</span><i/><Flower2 size={17}/><span>{t('brand')}</span></div></div><div className="hero-visual"><Ornament className="hero-mandala"/><div className="hero-arch"><div className="hero-photo"/><div className="arch-outline"/><div className="lamp-fallback" aria-hidden="true"><span className="flame"/><span className="bowl"/><span className="stem"/><span className="base"/></div></div><div className="hero-seal"><Sun size={22} strokeWidth={1}/><span>{t('heroSeal')}</span></div><div className="hero-caption">॥ ॐ शान्तिः शान्तिः शान्तिः ॥</div></div></section>
        <div className="welcome-strip"><span/><Flower2 size={22} strokeWidth={1}/><p>{t('welcome')}</p><span/></div>
        <section className="section container"><div className="section-heading"><p className="eyebrow">{t('servicesLabel')}</p><h2>{t('servicesTitle')}</h2><div className="heading-rule"/></div><div className="service-grid">{([{Icon:BookOpen,title:'jatakamTitle',body:'jatakamBody',to:'consultations'},{Icon:Flower2,title:'gatheringsTitle',body:'gatheringsBody',to:'events'},{Icon:HeartHandshake,title:'communityTitle',body:'communityBody',to:'dashboard'}] as const).map(({Icon,title,body,to},i) => <article className="service-card" key={title}><span className="card-number">0{i+1}</span><div className="service-icon"><Icon size={32} strokeWidth={1.2}/></div><h3>{t(title)}</h3><p>{t(body)}</p><button className="text-button" onClick={() => { if(to === 'dashboard' && !profile) setAuth(true); else navigate(to); }}>{t('learnMore')}<ArrowRight size={17}/></button></article>)}</div></section>
        <section className="events-section"><div className="container"><div className="section-heading horizontal"><div><p className="eyebrow">{t('upcoming')}</p><h2>{t('eventsTitle')}</h2></div><button className="text-button" onClick={() => navigate('events')}>{t('allEvents')}<ArrowRight size={18}/></button></div>{loadingEvents ? <p>{t('loading')}</p> : events.length ? eventCards(events.slice(0,2)) : <p className="empty">{t('noEvents')}</p>}</div></section>
        <section className="journey section container"><div className="journey-intro"><p className="eyebrow">{t('stepsLabel')}</p><h2>{t('stepsTitle')}</h2><Ornament/></div><div className="steps">{(['1','2','3'] as const).map(n => <div className="step" key={n}><span>0{n}</span><div><h3>{t(`step${n}`)}</h3><p>{t(`step${n}Body`)}</p></div></div>)}</div></section>
      </>}
      {page === 'events' && <section className="container section"><div className="page-heading"><p className="eyebrow">{t('upcoming')}</p><h1>{t('eventsTitle')}</h1></div>{loadingEvents ? <p>{t('loading')}</p> : events.length ? eventCards(events) : <div className="empty">{t('noEvents')}</div>}</section>}
      {page === 'consultations' && <section className="container section consultation-layout"><div className="consultation-intro"><p className="eyebrow">{t('jatakamEyebrow')}</p><h1>{t('jatakamHeading')}</h1><p>{t('jatakamIntro')}</p><div className="security-note"><ShieldCheck size={26}/><div><h3>{t('secure')}</h3><p>{t('secureBody')}</p></div></div><Ornament/></div><form className="panel form-stack" onSubmit={e => { e.preventDefault(); if (!requireLogin()) return; const form = e.currentTarget; const data = new FormData(form); const file = data.get('image') as File; if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) { setError('invalidImage'); return; } void run(async () => { await api('/consultations', { method:'POST',body:data }); form.reset(); navigate('dashboard'); setNotice('submitted'); }); }}><span className="form-emblem"><Flower2 size={30} strokeWidth={1}/></span><h2>{t('jatakamTitle')}</h2><label className="upload-zone"><UploadCloud size={28}/><strong>{t('image')}</strong><span>{t('imageHelp')}</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp" required/></label><label>{t('notes')}<textarea name="notes" placeholder={t('notesPlaceholder')} maxLength={4000} required/></label>{consultationFee !== null && <div className="row between"><span>{t('consultationFee')}</span><strong>{money(consultationFee)}</strong></div>}<div className="notice">{t('paymentDeferred')}</div><button className="button" disabled={busy || !authClient}>{busy ? t('loading') : t(profile ? 'submit' : 'signInFirst')}<ArrowRight size={18}/></button></form></section>}
      {page === 'dashboard' && <section className="container section dashboard">{!profile ? <div className="empty"><Flower2 size={40}/><h1>{t('dashboard')}</h1><p>{t('signInFirst')}</p><button className="button" onClick={() => setAuth(true)}>{t('login')}</button></div> : <>
        <div className="dashboard-greeting"><div><p className="eyebrow">{t(profile.role === 'admin' ? 'admin' : profile.role === 'ayyagaru' ? 'team' : 'dashboard')}</p><h1>{t('greeting')}, {profile.name}.</h1></div><span className="round-symbol"><Flower2 size={38} strokeWidth={1}/></span></div>
        <div className="dashboard-layout"><div className="dashboard-main"><h2>{t(profile.role === 'admin' ? 'requests' : profile.role === 'ayyagaru' ? 'work' : 'myConsultations')}</h2>{busy && <p role="status">{t('loading')}</p>}<div className="request-list">{consultations.length ? consultations.map(c => requestCard(c, profile.role !== 'user')) : <p className="empty">{t(profile.role === 'ayyagaru' ? 'noWork' : 'emptyConsultations')}</p>}</div>
        <h2>{t('myBookings')}</h2>{bookings.length ? bookings.map(booking => <article className="request-card" key={booking.id}><div className="row between"><h3>{content(booking.events.title)}</h3><span className={`badge ${booking.status}`}>{status(booking.status)}</span></div><p>{date(booking.events.starts_at)}</p><small>{t('bookingId')}: {booking.id.slice(0,8)}</small>{booking.status === 'confirmed' && <button className="text-button" onClick={() => setTicket(booking)}>{t('ticket')}<ArrowUpRight size={16}/></button>}{booking.status === 'awaiting_payment' && <p className="notice">{t('bookingPending')}</p>}</article>) : <p className="empty">{t('emptyBookings')}</p>}
        {profile.role === 'admin' && <>
          <div className="row between"><h2>{t('manageEvents')}</h2></div><EventEditor t={t} busy={busy} submit={data => run(async () => { await api('/admin/events', {method:'POST',body:JSON.stringify(data)}); await loadEvents(); setNotice('saved'); })}/><AdminEvents t={t} content={content} refresh={loadEvents} run={run}/>
          <h2>{t('notificationStatus')}</h2>{demoMode && <p className="notice">{t('demoQueueHint')}</p>}<div className="panel">{notifications.length ? notifications.map(item => <div className="row between queue-row" key={item.id}><span>{t(item.kind === 'event_announcement' ? 'events' : item.kind === 'booking_confirmation' ? 'myBookings' : 'consultations')}</span><span className={`badge ${item.status}`}>{status(item.status)}</span></div>) : <p className="muted">{t('none')}</p>}</div>
        </>}
        </div><aside className="dashboard-side" key={profile.id}><form className="panel form-stack" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => { await api('/me', {method:'PATCH',body:JSON.stringify({ language,whatsapp_opt_in:data.has('whatsapp_opt_in'),available:data.has('available') })}); await loadProfile(); setNotice('saved'); }); }}><h3>{t('preferences')}</h3><p className="muted">{profile.phone}</p><label className="checkbox"><input type="checkbox" name="whatsapp_opt_in" defaultChecked={profile.whatsapp_opt_in}/><span>{t('whatsapp')}</span></label>{profile.role !== 'user' && <label className="checkbox"><input type="checkbox" name="available" defaultChecked={profile.available}/><span>{t('availability')}</span></label>}<button className="button secondary" disabled={busy}>{t('save')}</button></form>
        {profile.role === 'admin' && <><form className="panel form-stack" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const data = new FormData(form); const mobile = String(data.get('phone')); if (!validPhone(mobile)) return setError('invalidPhone'); void run(async () => { await api('/admin/team', {method:'POST',body:JSON.stringify({phone:phoneNumber(mobile)})}); form.reset(); await loadWorkspace(); setNotice('saved'); }); }}><h3>{t('addTeam')}</h3><p className="muted">{t('teamHelp')}</p><label>{t('phone')}<input name="phone" type="tel" maxLength={10} pattern="[6-9][0-9]{9}" required/></label><button className="button secondary" disabled={busy}>{t('add')}</button><div className="team-list">{team.map(member => <div className="row" key={member.id}><span className="avatar">{member.name.slice(0,1)}</span><span>{member.name}<small>{member.phone}</small></span></div>)}</div></form><form className="panel form-stack" onSubmit={e => {e.preventDefault(); const data = new FormData(e.currentTarget); void run(async () => {await api('/admin/settings',{method:'PATCH',body:JSON.stringify({consultation_fee_paise:Math.round(Number(data.get('fee'))*100)})}); await loadEvents(); setNotice('saved'); });}}><h3>{t('settings')}</h3><label>{t('consultationFee')} (₹)<input type="number" name="fee" min="0" max="1000000" step="0.01" required defaultValue={(consultationFee ?? 0)/100}/></label><button className="button secondary" disabled={busy}>{t('save')}</button></form></>}
        </aside></div>
      </>}</section>}
      {!['home','events','consultations','dashboard'].includes(page) && <section className="section container empty"><h1>{t('home')}</h1><a className="button" href="#home">{t('back')}</a></section>}
    </main>
    <footer><div className="footer-main container"><div className="footer-brand"><a href="#home" className="brand"><span className="brand-symbol"><Flower2 size={34} strokeWidth={1}/></span><span><strong>{t('brand')}</strong><small>EKATVAM SEVA</small></span></a><p>{t('footerBody')}</p></div><div><h3>{t('explore')}</h3><a href="#consultations">{t('consultations')}</a><a href="#events">{t('events')}</a><button className="text-button" onClick={() => profile ? navigate('dashboard') : setAuth(true)}>{t('dashboard')}</button></div><div><h3>{t('chooseLanguage')}</h3><div className="footer-languages">{Object.entries(languages).map(([key,label]) => <button className={language === key ? 'selected' : ''} key={key} onClick={() => setLanguage(key as Language)} lang={key}>{label}</button>)}</div><span className="footer-flower"><Flower2 size={48} strokeWidth={.6}/></span></div></div><div className="footer-bottom container"><span>© {new Date().getFullYear()} {t('brand')}. {t('footerNote')}</span><button className="text-button" onClick={() => setPrivacy(true)}>{t('privacy')}</button></div></footer>
    {auth && <Auth t={t} language={language} close={() => setAuth(false)} done={() => { setAuth(false);setSelectedEvent(null);setTicket(null);setJatakamImage(null);setConsultations([]);setBookings([]);setTeam([]);setNotifications([]);void loadEvents();void loadProfile();navigate('dashboard'); }}/>}
    {privacy && <Modal title={t('privacy')} close={() => setPrivacy(false)} closeLabel={t('close')}><p className="prose">{t('privacyText')}</p></Modal>}
    {jatakamImage && <Modal title={t('viewImage')} close={() => setJatakamImage(null)} closeLabel={t('close')}><img src={jatakamImage} alt={t('image')} style={{width:'100%',height:'auto',borderRadius:4}}/></Modal>}
    {selectedEvent && <Modal title={content(selectedEvent.title)} close={() => setSelectedEvent(null)} closeLabel={t('close')}><div className="event-detail-symbol"><Flower2 size={46} strokeWidth={1}/></div><p>{content(selectedEvent.description)}</p><p className="row"><CalendarDays size={18}/>{date(selectedEvent.starts_at, {hour:'numeric',minute:'2-digit'})}</p><p className="row"><MapPin size={18}/>{content(selectedEvent.venue)}</p><p className="row"><Users size={18}/>{selectedEvent.available ?? selectedEvent.capacity} {t('remaining')}</p><div className="modal-price"><strong>{money(selectedEvent.fee_paise)}</strong></div>{selectedEvent.fee_paise > 0 && <p className="notice">{t('paymentDeferred')}</p>}{demoMode && <p className="notice">{t('demoHint')}</p>}<button className="button full-width" disabled={!authClient || busy || selectedEvent.available === 0} onClick={() => void bookEvent(selectedEvent)}>{t(selectedEvent.available === 0 ? 'full' : 'book')}<ChevronRight size={18}/></button></Modal>}
    {ticket && <Modal title={t('ticket')} close={() => setTicket(null)} closeLabel={t('close')}><div className="invitation"><Flower2 size={44} strokeWidth={1}/><p>{t('brand')}</p><h2>{content(ticket.events.title)}</h2><p>{date(ticket.events.starts_at, {hour:'numeric',minute:'2-digit'})}</p><p>{content(ticket.events.venue)}</p><hr/><p>{t('attendee')}: {profile?.name}</p><span className="badge confirmed"><Check size={14}/>{t('confirmed')}</span><small>{t('bookingId')}: {ticket.id}</small></div><p className="fine-print">{t('cancellationHelp')}</p><button className="button secondary full-width" onClick={() => window.print()}>{t('print')}</button></Modal>}
  </>;
}

function EventEditor({ t, busy, submit }: { t:T; busy:boolean; submit:(data:unknown)=>Promise<void> }) {
  const [open,setOpen] = useState(false);
  return <div className="panel"><button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>{t('createEvent')}<span>{open ? '−' : '+'}</span></button>{open && <form className="form-stack event-editor" onSubmit={e => {e.preventDefault(); const form=e.currentTarget; const fields = new FormData(form); const values=(key:string)=>Object.fromEntries(Object.keys(languages).map(lang=>[lang,String(fields.get(`${key}_${lang}`)).trim()])); void submit({title:values('title'),description:values('description'),venue:values('venue'),starts_at:new Date(`${fields.get('date')}:00+05:30`).toISOString(),fee_paise:Math.round(Number(fields.get('fee'))*100),capacity:Number(fields.get('capacity'))});}}>{Object.entries(languages).map(([lang,label]) => <fieldset key={lang} lang={lang}><legend>{label}</legend><label>{t('title')}<input name={`title_${lang}`} maxLength={200} required/></label><label>{t('description')}<textarea name={`description_${lang}`} maxLength={3000} required/></label><label>{t('venue')}<input name={`venue_${lang}`} maxLength={200} required/></label></fieldset>)}<label>{t('date')}<input type="datetime-local" name="date" required/></label><div className="form-columns"><label>{t('fee')}<input type="number" min="0" max="1000000" step="0.01" name="fee" defaultValue="0" required/></label><label>{t('capacity')}<input type="number" min="1" max="100000" name="capacity" defaultValue="100" required/></label></div><button className="button" disabled={busy}>{t('createEvent')}</button><small>{t('publishHelp')}</small></form>}</div>;
}
function AdminEvents({t,content,refresh,run}:{t:T;content:(v:Record<string,string>)=>string;refresh:()=>Promise<void>;run:(action:()=>Promise<void>)=>Promise<void>}) {
  const [events,setEvents]=useState<Event[]>([]);
  async function load(){setEvents(await api('/admin/events'));}
  useEffect(()=>{void load().catch(()=>{});},[refresh]);
  return <div className="admin-events">{events.map(event=><article className="request-card row between" key={event.id}><div><h3>{content(event.title)}</h3><span className="badge">{t(event.published?'published':'draft')}</span></div>{!event.published && <button className="button small" onClick={()=>void run(async()=>{await api(`/admin/events/${event.id}/publish`,{method:'POST'});await load();await refresh();})}>{t('publish')}<Bell size={15}/></button>}</article>)}</div>;
}
