import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search, RefreshCw, ArrowDown, ArrowUp, Bookmark, X, ExternalLink, MapPin, Building2, AlertTriangle, CheckCircle2, HelpCircle, Undo2 } from 'lucide-react';
import { loadJobs, loadPrefs, loadHealth, runScan, savePrefs, getSettings, patchSettings, notifyTest, checkCompany, lastScanTime, DEFAULT_COMPANIES, waLink, inIndia, TA_TERMS, hasTerm, analyzeMetrics, INTERVIEW_PREP, encryptBackup, restoreBackup } from './engine';

const APP_NAME = 'Made with care'; // <- change your app's name here

type Job = {
  title: string; company: string; location_normalized?: string; canonical_url: string;
  content_text?: string; score: number; matched_criteria: string[]; red_flags: string[];
  unknown_fields: string[]; status: string; why_apply?: string; is_bengaluru?: boolean; is_remote?: boolean; first_seen?: string;
};
type Prefs = Record<string, any>;
type Tab = 'jobs' | 'review' | 'saved' | 'applied' | 'skipped' | 'prefs' | 'cv' | 'linkedin' | 'settings' | 'alerts' | 'check' | 'sources';
type Profile = { name: string; email: string; phone: string; linkedin: string; notice: string; ctc: string; note: string; resume: string };
type Cv = { name: string; data: string } | null;
const emptyProfile: Profile = { name: '', email: '', phone: '', linkedin: '', notice: '', ctc: '', resume: '', note: 'Hi {company} team, I am excited about the {role} role. [Add one real result you delivered, such as a hiring number or time-to-fill.] [Say in one line why this company.]' };
const DAY = 86400000;
const isMnc = (j: Job) => (j.matched_criteria || []).some(c => /MNC|allowlist/i.test(c));
type Mark = 'saved' | 'skipped' | 'applied';

const tone = (s: number) => s >= 70 ? 'text-green-400 bg-green-500/10 border-green-500/30' : s >= 45 ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : 'text-rose-400 bg-rose-500/10 border-rose-500/30';
const barTone = (s: number) => s >= 70 ? 'bg-good' : s >= 45 ? 'bg-warn' : 'bg-bad';
const loadMarks = (): Record<string, Mark> => { try { return JSON.parse(localStorage.getItem('jr_marks') || '{}'); } catch { return {}; } };

export default function App() {
  const [tab, setTab] = useState<Tab>('jobs');
  const [allJobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [intro, setIntro] = useState(true);
  const [marks, setMarks] = useState(loadMarks);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const [minScore, setMinScore] = useState(0);
  const [loc, setLoc] = useState<'all' | 'india' | 'blr'>('all');
  const [sort, setSort] = useState<'score' | 'title'>('score');
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState('');
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<number>();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [health, setHealth] = useState<Record<string, any>>({});
  const jobs = useMemo(() => {
    const b = ((prefs?.blocklist_companies || []) as string[]).map(x => x.toLowerCase().trim()).filter(Boolean);
    return b.length ? allJobs.filter(j => !b.some(x => (j.company || '').toLowerCase().includes(x))) : allJobs;
  }, [allJobs, prefs]);
  const [atBottom, setAtBottom] = useState(false);
  const [digest, setDigest] = useState('');
  const [lens, setLens] = useState<'overview' | 'hiring' | 'prep'>('overview');
  const [startHidden, setStartHidden] = useState(() => { try { return localStorage.getItem('jr_start_done') === '1'; } catch { return false; } });
  const [mncOnly, setMncOnly] = useState(false);
  const [profile, setProfile] = useState<Profile>(() => { try { return { ...emptyProfile, ...JSON.parse(localStorage.getItem('jr_profile') || '{}') }; } catch { return emptyProfile; } });
  const [cv, setCv] = useState<Cv>(() => { try { return JSON.parse(localStorage.getItem('jr_cv') || 'null'); } catch { return null; } });
  useEffect(() => { try { localStorage.setItem('jr_profile', JSON.stringify(profile)); } catch {} }, [profile]);

  const refresh = useCallback(async () => {
    try {
      const [j, p, h] = [loadJobs(), loadPrefs(), loadHealth()];
      setJobs(Array.isArray(j) ? j : []); setPrefs(p); setHealth(h);
    } catch { setMsg('Something went wrong while loading your saved data.'); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); const t = setTimeout(() => setIntro(false), 1500); return () => clearTimeout(t); }, [refresh]);
  useEffect(() => {
    const tick = async () => {
      if (Date.now() - lastScanTime() < getSettings().everyHours * 3600000) return;
      setScanning(true);
      try { const r = await runScan(); if (!r.busy) { setDigest(r.digest || ''); await refresh(); } } catch {}
      setScanning(false);
    };
    const a = setTimeout(tick, 2500); const b = setInterval(tick, 10 * 60 * 1000);
    return () => { clearTimeout(a); clearInterval(b); };
  }, [refresh]);

  const showToast = (text: string, undo?: () => void) => {
    setToast({ text, undo });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  };

  const setMark = useCallback((url: string, v: Mark | null) => {
    try { const at = JSON.parse(localStorage.getItem('jr_applied_at') || '{}'); if (v === 'applied') at[url] = Date.now(); else delete at[url]; localStorage.setItem('jr_applied_at', JSON.stringify(at)); } catch {}
    setMarks(prev => {
      const next = { ...prev };
      if (v) next[url] = v; else delete next[url];
      try { localStorage.setItem('jr_marks', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const scan = async () => {
    setScanning(true); setMsg('');
    try {
      const r = await runScan();
      setDigest(r.digest || '');
      if (r.removed?.length) setMsg(`Removed ${r.removed.length} company name(s) that have no job board: ${r.removed.join(', ')}.`);
      showToast(r.busy ? 'A scan is already running. Try again in a minute.' : r.totalRawFetched === 0 ? 'Scan found 0 jobs. Check your internet connection and the Sources tab.' : `Scan done: ${r.totalJobsInDatabase} matching jobs (${r.bengaluruJobs} in Bengaluru) from ${r.totalRawFetched} openings checked.`);
      await refresh();
    } catch { setMsg('The scan failed. Check the terminal for errors.'); }
    setScanning(false);
  };

  const visible = useMemo(() => {
    const t = dq.toLowerCase();
    const list = jobs.filter(j => {
      const m = marks[j.canonical_url];
      if (tab === 'saved' || tab === 'applied' || tab === 'skipped' ? m !== tab : !!m) return false;
      if (mncOnly && !isMnc(j)) return false;
      if (tab === 'review' && j.status !== 'review') return false;
      if (j.score < minScore) return false;
      if (loc === 'blr' && !j.is_bengaluru) return false;
      if (loc === 'india' && !(j.is_bengaluru || inIndia(j.location_normalized || ''))) return false;
      return !t || `${j.title} ${j.company}`.toLowerCase().includes(t);
    });
    return sort === 'title' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [jobs, marks, tab, dq, minScore, loc, mncOnly, sort]);

  const job = jobs.find(j => j.canonical_url === selected) || null;

  const act = useCallback((j: Job, v: Mark) => {
    const prev = marks[j.canonical_url] ?? null;
    const idx = visible.findIndex(x => x.canonical_url === j.canonical_url);
    const nxt = visible[idx + 1] || visible[idx - 1];
    setMark(j.canonical_url, v);
    setSelected(nxt ? nxt.canonical_url : null);
    showToast(`${v === 'saved' ? 'Saved' : 'Skipped'}: ${j.title}`, () => { setMark(j.canonical_url, prev); setSelected(j.canonical_url); setToast(null); });
  }, [marks, visible, setMark]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || e.metaKey || e.ctrlKey || !['jobs', 'review', 'saved', 'applied', 'skipped'].includes(tab)) return;
      const i = visible.findIndex(x => x.canonical_url === selected);
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const n = visible[Math.min(i + 1, visible.length - 1)]; if (n) setSelected(n.canonical_url); }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const n = visible[Math.max(i - 1, 0)]; if (n) setSelected(n.canonical_url); }
      else if (e.key === 's' && job && tab !== 'saved') act(job, 'saved');
      else if (e.key === 'x' && job && tab !== 'skipped') act(job, 'skipped');
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected, job, tab, act]);

  useEffect(() => { if (selected) document.getElementById('row-' + selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected]);

  useEffect(() => {
    const check = () => {
      const de = document.documentElement;
      const winBottom = window.innerHeight + window.scrollY >= de.scrollHeight - 40;
      setAtBottom(winBottom);
    };
    check();
    window.addEventListener('scroll', check, true);
    window.addEventListener('resize', check);
    return () => { window.removeEventListener('scroll', check, true); window.removeEventListener('resize', check); };
  }, [tab, visible.length, loading]);

  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    const look = () => document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-seen])').forEach(el => { el.setAttribute('data-seen', '1'); io.observe(el); });
    look();
    const mo = new MutationObserver(look); mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);

  const uploadCv = (f: File) => {
    if (f.size > 3 * 1024 * 1024) { showToast('That file is over 3 MB. Please use a smaller CV.'); return; }
    const r = new FileReader();
    r.onload = () => {
      const next = { name: f.name, data: String(r.result) };
      setCv(next);
      try { localStorage.setItem('jr_cv', JSON.stringify(next)); showToast('CV saved in this browser.'); } catch { showToast('Could not save the CV in the browser.'); }
    };
    r.readAsDataURL(f);
  };
  const removeCv = () => { setCv(null); try { localStorage.removeItem('jr_cv'); } catch {} showToast('CV removed.'); };
  const applyKit = (j: Job) => {
    window.open(j.canonical_url, '_blank', 'noopener');
    const note = profile.note.replace(/\{company\}/g, j.company).replace(/\{role\}/g, j.title);
    navigator.clipboard?.writeText(note).catch(() => {});
    const blanks = (note.match(/\[[^\]]*\]/g) || []).length;
    showToast(blanks ? `Opened. Your cover note still has ${blanks} [blank] to fill in with something real before you send it.` : cv ? 'Company page opened and cover note copied. Attach your CV, check the form, and press Submit yourself.' : 'Company page opened. Add your CV in the CV & details tab so it is ready next time.');
  };
  const markApplied = (j: Job) => {
    const prev = marks[j.canonical_url] ?? null;
    setMark(j.canonical_url, 'applied');
    showToast(`Marked as applied: ${j.title}`, () => { setMark(j.canonical_url, prev); setToast(null); });
  };
  const stats = useMemo(() => {
    let at: Record<string, number> = {};
    try { at = JSON.parse(localStorage.getItem('jr_applied_at') || '{}'); } catch {}
    const now = Date.now(); const open = jobs.filter(j => !marks[j.canonical_url]);
    return {
      fresh: open.filter(j => j.first_seen && now - Date.parse(j.first_seen) < DAY).length,
      strong: open.filter(j => j.score >= 70).length,
      week: Object.entries(marks).filter(([u, m]) => m === 'applied' && now - (at[u] || 0) < 7 * DAY).length,
      due: Object.entries(marks).filter(([u, m]) => m === 'applied' && at[u] && now - at[u] >= 5 * DAY).length,
    };
  }, [jobs, marks]);
  const count = (f: (j: Job) => boolean) => jobs.filter(f).length;
  const tabs: [Tab, string, number?][] = [
    ['jobs', 'Best matches', count(j => !marks[j.canonical_url])],
    ['review', 'Needs a look', count(j => j.status === 'review' && !marks[j.canonical_url])],
    ['saved', 'Saved', count(j => marks[j.canonical_url] === 'saved')],
    ['applied', 'Applied', count(j => marks[j.canonical_url] === 'applied')],
    ['skipped', 'Skipped', count(j => marks[j.canonical_url] === 'skipped')],
    ['check', 'Check a job'], ['linkedin', 'LinkedIn'], ['cv', 'CV & details'], ['prefs', 'My preferences'], ['alerts', 'WhatsApp alerts'], ['sources', 'Sources'],
  ];
  const isList = ['jobs', 'review', 'saved', 'applied', 'skipped'].includes(tab);
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-bloom bg-bloom text-white' : 'border-line bg-card text-muted hover:border-bloom'}`;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-card text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{APP_NAME}</h1>
            <p className="hidden text-sm text-muted sm:block">Bengaluru roles, ranked for you. You decide what to apply to.</p>
          </div>
          <button onClick={scan} disabled={scanning} className="flex items-center gap-2 rounded-full bg-bloom px-5 py-2.5 font-semibold hover:bg-bloom-hover disabled:opacity-70">
            <RefreshCw size={18} className={scanning ? 'animate-spin' : ''} />{scanning ? 'Scanning…' : 'Scan for new jobs'}
          </button>
        </div>
        <div className={`relative mx-auto h-1 max-w-7xl overflow-hidden rounded-full transition-opacity ${scanning ? 'indet bg-card/10 opacity-100' : 'opacity-0'}`} />
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5 pt-1">
          {tabs.map(([id, label, n]) => (
            <button key={id} onClick={() => { setTab(id); setSelected(null); }}
              className={`whitespace-nowrap rounded-t-xl px-4 py-2.5 text-sm font-semibold ${tab === id ? 'bg-paper text-ink' : 'text-muted hover:bg-card/10 hover:text-white'}`}>
              {label}{n !== undefined && <span className="ml-2 rounded-full bg-bloom-soft px-2 py-0.5 text-xs text-ice">{n}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main className={`mx-auto max-w-7xl px-5 pt-6 ${isList ? 'pb-6' : 'pb-48'}`}>
        {msg && <div className="fade mb-5 flex justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 text-sm"><span>{msg}</span><button onClick={() => setMsg('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {tab === 'prefs' && <div className="fade"><PrefsView prefs={prefs} setPrefs={setPrefs} toast={showToast} /></div>}
        {tab === 'alerts' && <div className="fade"><AlertsView toast={showToast} /></div>}
        {tab === 'check' && <div className="fade"><CheckJob profile={profile} extra={prefs?.must_have_keywords || []} /></div>}
        {tab === 'linkedin' && <div className="fade"><LinkedInView /></div>}
        {tab === 'cv' && <div className="fade"><CvView cv={cv} upload={uploadCv} remove={removeCv} profile={profile} setProfile={setProfile} toast={showToast} /></div>}
        {tab === 'sources' && <div className="fade"><SourcesView health={health} /></div>}

        {tab === 'jobs' && !loading && !startHidden && <GetStarted cv={cv} profile={profile} go={t => { setTab(t); setSelected(null); }} hide={() => { setStartHidden(true); try { localStorage.setItem('jr_start_done', '1'); } catch {} }} />}
        {tab === 'jobs' && digest && <div className="fade mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ice bg-bloom-soft px-4 py-3 text-sm"><span>New matching jobs were found.</span><a href={waLink(digest)} target="_blank" rel="noreferrer" className="rounded-full bg-bloom px-4 py-1.5 font-semibold text-white hover:bg-bloom-hover">Send to my WhatsApp</a></div>}
        {tab === 'jobs' && !loading && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['New in 24 hours', stats.fresh], ['Strong matches', stats.strong], ['Applied this week', stats.week], ['Follow-ups due', stats.due]] as [string, number][]).map(([l, n], i) => (
              <div key={l} style={{ animationDelay: `${i * 80}ms` }} className={`rise rounded-2xl border bg-card p-4 ${l === 'Follow-ups due' && n > 0 ? 'border-bloom' : 'border-line'}`}>
                <p className="font-display text-3xl font-extrabold"><CountUp to={n} /></p><p className="text-sm text-muted">{l}</p>
              </div>
            ))}
          </div>
        )}
        {isList && (
          <div className="grid gap-6 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[minmax(0,26rem)_1fr]">
            <section className="flex min-h-0 flex-col">
              <div className="relative mb-3">
                <Search size={16} className="absolute left-3 top-3.5 text-muted" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title or company"
                  className="w-full rounded-xl border border-line bg-card py-2.5 pl-9 pr-3 transition focus:border-bloom" />
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {[[0, 'All'], [50, '50+'], [70, '70+']].map(([v, l]) => <button key={v} onClick={() => setMinScore(v as number)} className={chip(minScore === v)}>Score {l}</button>)}
                {([['all', 'Anywhere'], ['india', 'India'], ['blr', 'Bengaluru']] as const).map(([v, l]) => <button key={v} onClick={() => setLoc(v)} className={chip(loc === v)}>{l}</button>)}
                <button onClick={() => setMncOnly(!mncOnly)} className={chip(mncOnly)}>MNC only</button>
                <button onClick={() => setSort(sort === 'score' ? 'title' : 'score')} className={chip(false)}>Sort: {sort === 'score' ? 'best first' : 'A to Z'}</button>
              </div>
              <p className="mb-3 text-xs text-muted">{visible.length} jobs. Tip: use ↑ ↓ to browse, S to save, X to skip. {loc !== 'all' && visible.length < 10 && <button onClick={() => setLoc('all')} className="font-semibold text-ice underline">Show all locations</button>}</p>

              {loading ? (
                <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="skel h-24" />)}</div>
              ) : visible.length === 0 ? (
                <div className="fade rounded-2xl border border-dashed border-line bg-card p-8 text-center">
                  <p className="font-display text-lg font-bold">Nothing here yet</p>
                  <p className="mt-1 text-sm text-muted">{jobs.length === 0 ? 'Press “Scan for new jobs” to fetch the latest openings.' : 'No jobs match these filters. Loosen them or try another tab.'}</p>
                </div>
              ) : (
                <ul id="job-list" className="min-h-0 flex-1 scroll-smooth overscroll-contain pr-1 lg:overflow-y-auto">
                  {visible.map((j, i) => (
                    <li key={j.canonical_url} id={'row-' + j.canonical_url} data-reveal className="row px-1.5 py-1.5" style={{ transitionDelay: `${(i % 6) * 45}ms` }}>
                      <button onClick={() => setSelected(j.canonical_url)}
                        className={`flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left ${selected === j.canonical_url ? 'border-bloom ring-4 ring-bloom-soft' : 'border-line hover:-translate-y-0.5 hover:border-ice hover:bg-card-hover'}`}>
                        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border font-display text-lg font-extrabold ${tone(j.score)}`}>{j.score}</span>
                        <span className="min-w-0">
                          <span className="block font-display font-bold leading-snug">{j.title}{j.first_seen && Date.now() - Date.parse(j.first_seen) < DAY && <span className="ml-2 rounded-full bg-bloom px-2 py-0.5 align-middle text-[10px] font-bold text-white">NEW</span>}</span>
                          <span className="mt-0.5 flex items-center gap-1 text-sm capitalize text-muted"><Building2 size={14} />{j.company}</span>
                          <span className="flex items-center gap-1 text-sm text-muted"><MapPin size={14} />{j.location_normalized || 'Location not stated'}</span>
                          <span className={`mt-1 inline-block text-xs font-semibold ${j.score >= 70 ? 'text-good' : j.score >= 45 ? 'text-warn' : 'text-muted'}`}>{j.score >= 70 ? 'Strong match' : j.score >= 45 ? 'Possible match' : 'Weak match'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`fixed inset-x-0 bottom-0 top-24 z-30 overflow-auto rounded-t-3xl bg-paper p-3 shadow-2xl transition-transform duration-300 lg:static lg:z-auto lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:scroll-smooth lg:pb-28 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none ${job ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}`}>
              {!job ? (
                <div className="hidden min-h-64 place-items-center rounded-2xl border border-line bg-card p-8 text-center text-muted lg:grid">Select a job to see why it matched and what to watch out for.</div>
              ) : (
                <article key={job.canonical_url} className="fade rounded-2xl border border-line bg-card p-5 sm:p-6">
                  <button onClick={() => setSelected(null)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-ice lg:hidden"><X size={16} />Close</button>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="font-display text-2xl font-extrabold leading-tight">{job.title}</h2>
                      <p className="mt-1 capitalize text-muted">{job.company} · {job.location_normalized || 'Location not stated'}</p>
                      {isMnc(job) && <span className="mt-2 inline-block rounded-full border border-bloom px-3 py-0.5 text-xs font-semibold text-ice">MNC / global company site</span>}
                    </div>
                    <div className="w-28">
                      <p className="text-right font-display text-2xl font-extrabold">{job.score}<span className="text-sm font-semibold text-muted">/100</span></p>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper"><div className={`bar h-full rounded-full ${barTone(job.score)}`} style={{ width: `${job.score}%` }} /></div>
                    </div>
                  </div>
                  {job.why_apply && <p className="mt-4 rounded-xl bg-bloom-soft px-4 py-3 text-sm">{job.why_apply}</p>}
                  <div className="mt-5 inline-flex flex-wrap rounded-full border border-line bg-paper p-1 text-sm font-semibold">
                    {([['overview', 'Overview'], ['hiring', 'Hiring manager view'], ['prep', 'Interview prep']] as const).map(([v, l]) => <button key={v} onClick={() => setLens(v)} className={`rounded-full px-4 py-1.5 ${lens === v ? 'bg-bloom text-white' : 'text-muted hover:text-white'}`}>{l}</button>)}
                  </div>
                  {lens === 'hiring' && <HiringView jd={job.content_text || ''} resume={profile.resume} extra={prefs?.must_have_keywords || []} />}
                  {lens === 'prep' && <InterviewPrep jd={`${job.title}\n${job.content_text || ''}`} />}
                  {lens === 'overview' && (<>
                  <Block icon={<CheckCircle2 size={16} className="text-good" />} title="Why it matched" items={job.matched_criteria} empty="No strong matches found." />
                  <Block icon={<AlertTriangle size={16} className="text-bad" />} title="Watch out for" items={job.red_flags} empty="No red flags found." />
                  <Block icon={<HelpCircle size={16} className="text-warn" />} title="Not stated in the posting" items={job.unknown_fields} empty="Nothing important is missing." />
                  <Outreach job={job} profile={profile} />
                  <details className="mt-5">
                    <summary className="cursor-pointer text-sm font-semibold text-ice">Read the job description</summary>
                    <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">{job.content_text || 'No description saved.'}</p>
                  </details>
                  </>)}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={() => applyKit(job)} className="flex items-center gap-2 rounded-full bg-bloom px-5 py-2.5 text-sm font-semibold text-white hover:bg-bloom-hover">Apply on company site <ExternalLink size={15} /></button>
                    <a href={`https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(job.title + ' ' + job.company)}&location=Bengaluru`} target="_blank" rel="noreferrer" className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold hover:bg-paper">Find on LinkedIn</a>
                    {marks[job.canonical_url] !== 'applied' && <button onClick={() => markApplied(job)} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold hover:bg-paper">I applied</button>}
                    {marks[job.canonical_url] ? (
                      <button onClick={() => { setMark(job.canonical_url, null); showToast('Moved back to matches'); }} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold hover:bg-paper">Move back to matches</button>
                    ) : (<>
                      <button onClick={() => act(job, 'saved')} className="flex items-center gap-2 rounded-full border border-bloom px-5 py-2.5 text-sm font-semibold text-ice hover:bg-bloom-soft"><Bookmark size={15} />Save</button>
                      <button onClick={() => act(job, 'skipped')} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-muted hover:bg-paper">Skip</button>
                    </>)}
                  </div>
                </article>
              )}
            </section>
          </div>
        )}
        {isList && <footer className="grid min-h-[45vh] place-items-center text-center"><p data-reveal className="font-display text-xl font-bold text-muted">Made with care. Every application is yours to send.</p></footer>}
      </main>

      <button onClick={() => window.scrollTo({ top: atBottom ? 0 : document.documentElement.scrollHeight, behavior: 'smooth' })} aria-label={atBottom ? 'Scroll to top' : 'Scroll to bottom'} className="fixed bottom-4 left-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-line bg-card shadow-lg hover:border-ice hover:bg-card-hover">{atBottom ? <ArrowUp size={18} /> : <ArrowDown size={18} />}</button>
      <Tulip show={atBottom} />
      <div aria-live="polite" className={`fixed bottom-5 left-1/2 z-40 -translate-x-1/2 transition-all duration-300 ${toast ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}`}>
        {toast && (
          <div className="flex items-center gap-4 rounded-full border border-line bg-card px-5 py-3 text-sm text-white shadow-xl">
            <span className="max-w-[60vw] truncate">{toast.text}</span>
            {toast.undo && <button onClick={toast.undo} className="flex items-center gap-1 font-semibold text-sky-400 hover:text-white"><Undo2 size={14} />Undo</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Tulip({ show }: { show: boolean }) {
  return (
    <div aria-hidden={!show} className={`pointer-events-none fixed bottom-0 right-3 z-20 flex items-end gap-1.5 transition-all duration-500 ease-out sm:right-6 ${show ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
      <span className="mb-3 rounded-full border border-line bg-card px-3 py-1 font-display text-sm font-bold text-white shadow-lg">Damini 😝</span>
      <svg role="img" aria-label="A small blue tulip" viewBox="0 0 140 220" className="sway block w-14 sm:w-[4.5rem]">
        <defs>
          <linearGradient id="tc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#0284c7" /></linearGradient>
          <linearGradient id="ts" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d4ed8" /><stop offset="1" stopColor="#1e3a8a" /></linearGradient>
        </defs>
        <path d="M70 108 C70 150 68 185 70 220" stroke="#0f766e" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M70 195 C40 185 28 152 34 128 C56 142 68 166 70 195Z" fill="#0d9488" />
        <path d="M70 178 C98 170 112 142 106 120 C86 134 72 154 70 178Z" fill="#14b8a6" />
        <path d="M34 30 C18 58 26 96 70 108 C58 78 56 52 34 30Z" fill="url(#ts)" />
        <path d="M106 30 C122 58 114 96 70 108 C82 78 84 52 106 30Z" fill="url(#ts)" />
        <path d="M70 14 C44 38 42 80 70 110 C98 80 96 38 70 14Z" fill="url(#tc)" />
      </svg>
    </div>
  );
}

type Added = { id: string; title: string; company: string; url: string; applied: boolean };

function LinkedInView() {
  const [list, setList] = useState<Added[]>(() => { try { return JSON.parse(localStorage.getItem('jr_added') || '[]'); } catch { return []; } });
  const [t, setT] = useState(''); const [c, setC] = useState(''); const [u, setU] = useState('');
  const [day, setDay] = useState(true); const [hyb, setHyb] = useState(false); const [easy, setEasy] = useState(false);
  const save = (n: Added[]) => { setList(n); try { localStorage.setItem('jr_added', JSON.stringify(n)); } catch {} };
  const link = (kw: string) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent('Bengaluru, Karnataka, India')}${day ? '&f_TPR=r86400' : ''}${hyb ? '&f_WT=3' : ''}${easy ? '&f_AL=true' : ''}`;
  const kws = ['Talent Acquisition Manager', 'Senior Talent Acquisition Partner', 'Head of Talent Acquisition', 'Recruitment Manager', 'Talent Acquisition Lead'];
  const add = () => {
    if (!t.trim() || !/^https?:\/\//.test(u.trim())) return;
    save([{ id: String(Date.now()), title: t.trim(), company: c.trim(), url: u.trim(), applied: false }, ...list]);
    setT(''); setC(''); setU('');
  };
  const field = 'mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 transition focus:border-bloom';
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs font-semibold ${on ? 'border-bloom bg-bloom text-white' : 'border-line text-muted hover:border-bloom'}`;
  return (
    <div className="max-w-3xl space-y-6">
      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">Find jobs on LinkedIn</h2>
        <p className="mt-1 text-sm text-muted">One click opens LinkedIn with the search already filled in for Bengaluru.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setDay(!day)} className={chip(day)}>Last 24 hours</button>
          <button onClick={() => setHyb(!hyb)} className={chip(hyb)}>Hybrid</button>
          <button onClick={() => setEasy(!easy)} className={chip(easy)}>Easy Apply</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {kws.map(k => <a key={k} href={link(k)} target="_blank" rel="noreferrer" className="rounded-full border border-bloom px-4 py-2 text-sm font-semibold text-ice hover:bg-bloom-soft">{k}</a>)}
        </div>
        <p className="mt-4 text-sm text-muted">If a filter does not stick, set it on LinkedIn directly. LinkedIn sometimes changes these links.</p>
      </div>

      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">Make LinkedIn apply in a few clicks</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
          <li>On LinkedIn, open <b>Settings</b> and find <b>Job application settings</b> (menu names change a little over time).</li>
          <li>Upload your CV there and save your phone, email and common screening answers.</li>
          <li>After that, on any <b>Easy Apply</b> job LinkedIn fills everything in. You click Easy Apply, Next, then Submit.</li>
          <li>Tap the bell icon on a search to get these jobs by email every day.</li>
        </ol>
      </div>

      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">Jobs I found on LinkedIn</h2>
        <p className="mt-1 text-sm text-muted">Paste the job link here to keep track of it next to your other jobs.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Job title<input className={field} value={t} onChange={e => setT(e.target.value)} /></label>
          <label className="block text-sm font-semibold">Company<input className={field} value={c} onChange={e => setC(e.target.value)} /></label>
          <label className="block text-sm font-semibold sm:col-span-2">LinkedIn job link<input className={field} value={u} placeholder="https://www.linkedin.com/jobs/view/..." onChange={e => setU(e.target.value)} /></label>
        </div>
        <button onClick={add} className="mt-4 rounded-full bg-bloom px-6 py-2.5 font-semibold text-white hover:bg-bloom-hover">Add job</button>
        {list.length === 0 ? <p className="mt-5 text-sm text-muted">No jobs added yet.</p> : (
          <ul className="mt-5 divide-y divide-line">
            {list.map(a => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="min-w-0"><b className="font-display">{a.title}</b><span className="block text-sm text-muted">{a.company || 'Company not added'}{a.applied ? ' · Applied' : ''}</span></span>
                <span className="flex gap-2 text-sm font-semibold">
                  <a href={a.url} target="_blank" rel="noreferrer" className="rounded-full bg-bloom px-4 py-1.5 text-white hover:bg-bloom-hover">Open</a>
                  <button onClick={() => save(list.map(x => x.id === a.id ? { ...x, applied: !x.applied } : x))} className="rounded-full border border-line px-4 py-1.5 hover:bg-paper">{a.applied ? 'Undo applied' : 'I applied'}</button>
                  <button onClick={() => save(list.filter(x => x.id !== a.id))} className="rounded-full border border-line px-4 py-1.5 text-muted hover:bg-paper">Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CvView({ cv, upload, remove, profile, setProfile, toast }: { cv: Cv; upload: (f: File) => void; remove: () => void; profile: Profile; setProfile: (p: Profile) => void; toast: (s: string) => void }) {
  const field = 'mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 transition focus:border-bloom';
  const [pw, setPw] = useState('');
  const exportAll = async () => {
    if (pw.length < 6) { toast('Choose a backup password with at least 6 characters.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await encryptBackup(pw)], { type: 'application/json' }));
    a.download = 'my-job-site-backup.json'; a.click();
  };
  const importAll = (f: File) => {
    if (!pw) { toast('Type the backup password first.'); return; }
    const r = new FileReader();
    r.onload = async () => { try { await restoreBackup(String(r.result), pw); location.reload(); } catch { toast('Wrong password or unreadable file.'); } };
    r.readAsText(f);
  };
  const gaps = analyzeMetrics(profile.resume);
  const missing = gaps.filter(g => !g.ok).map(g => g.label);
  const f = (k: keyof Profile, label: string, ph = '') => (
    <label className="block text-sm font-semibold">{label}
      <input className={field} value={profile[k]} placeholder={ph} onChange={e => setProfile({ ...profile, [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="max-w-3xl space-y-6">
      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">My CV</h2>
        <p className="mt-1 text-sm text-muted">Saved only in this browser on this computer. It is never uploaded anywhere by this app.</p>
        {cv && <p className="mt-4 rounded-xl bg-paper px-4 py-3 text-sm">Saved CV: <b>{cv.name}</b></p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <label className="cursor-pointer rounded-full bg-bloom px-5 py-2.5 text-sm font-semibold text-white hover:bg-bloom-hover">
            {cv ? 'Replace CV' : 'Upload CV (PDF or Word)'}
            <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const x = e.target.files?.[0]; if (x) upload(x); }} />
          </label>
          {cv && <a href={cv.data} download={cv.name} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold hover:bg-paper">Download CV</a>}
          {cv && <button onClick={remove} className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-muted hover:bg-paper">Remove</button>}
        </div>
      </div>
      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">My CV text and metric check</h2>
        <p className="mt-1 text-sm text-muted">Paste the text of your CV. It stays on this device and powers the Hiring manager view and the metric check. A recruiter looks for numbers in five areas.</p>
        <textarea rows={8} className={'mt-3 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm transition focus:border-ice'} value={profile.resume} placeholder="Paste your CV text here" onChange={e => setProfile({ ...profile, resume: e.target.value })} />
        {profile.resume.trim() && (
          <>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {gaps.map(g => <li key={g.label} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"><span className={g.ok ? 'text-good' : 'text-warn'}>{g.ok ? '✓' : '!'}</span>{g.label}</li>)}
            </ul>
            {missing.length > 0 && <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">Missing numbers or proof for: {missing.join(', ')}. Add real figures, for example days saved or % cost cut. Only add numbers that are true.</p>}
            <p className="mt-2 text-xs text-muted">This is a simple keyword and number check, not an AI review.</p>
          </>
        )}
      </div>

      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">My details</h2>
        <p className="mt-1 text-sm text-muted">Used to write your cover note. Write {'{company}'} and {'{role}'} where the job's name should go.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {f('name', 'Full name')}{f('email', 'Email')}{f('phone', 'Phone')}{f('linkedin', 'LinkedIn profile link')}{f('notice', 'Notice period', 'e.g. 30 days')}{f('ctc', 'Expected salary', 'e.g. 20 LPA')}
        </div>
        <label className="mt-4 block text-sm font-semibold">Cover note template
          <textarea rows={5} className={field} value={profile.note} onChange={e => setProfile({ ...profile, note: e.target.value })} />
        </label>
      </div>

      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">Back up my data</h2>
        <p className="mt-1 text-sm text-muted">Everything is saved in this browser only. Download a backup to move to another device or keep a safe copy. The file is encrypted with the password you type below. If you forget the password, the file cannot be opened.</p>
        <label className="mt-4 block text-sm font-semibold">Backup password<input type="password" className={field + ' sm:w-64'} value={pw} onChange={e => setPw(e.target.value)} autoComplete="off" /></label>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={exportAll} className="rounded-full bg-bloom px-5 py-2.5 text-sm font-semibold text-white hover:bg-bloom-hover">Download backup</button>
          <label className="cursor-pointer rounded-full border border-line px-5 py-2.5 text-sm font-semibold hover:bg-card-hover">Restore from backup
            <input type="file" accept=".json" className="hidden" onChange={e => { const x = e.target.files?.[0]; if (x) importAll(x); }} /></label>
        </div>
      </div>
    </div>
  );
}

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / 800); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

function GetStarted({ cv, profile, go, hide }: { cv: Cv; profile: Profile; go: (t: Tab) => void; hide: () => void }) {
  const steps: [string, boolean, Tab][] = [
    ['Add your CV', !!cv, 'cv'],
    ['Add your name and details', !!profile.name, 'cv'],
    ['Check your job titles and keywords', localStorage.getItem('jr_prefs') !== null, 'prefs'],
    ['Set up WhatsApp alerts (optional)', getSettings().whatsappKeySet, 'alerts'],
  ];
  return (
    <div className="fade mb-6 rounded-2xl border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold">Start here ({steps.filter(x => x[1]).length} of 4 done)</h2>
          <p className="text-sm text-muted">Four quick steps and the site is ready. Everything is saved in this browser only.</p>
        </div>
        <button onClick={hide} className="text-sm text-muted hover:text-white">Hide</button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {steps.map(([label, ok, t]) => (
          <li key={label}><button onClick={() => go(t)} className="flex w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm hover:bg-card-hover"><span className={ok ? 'text-good' : 'text-muted'}>{ok ? '✓' : '○'}</span>{label}</button></li>
        ))}
      </ul>
    </div>
  );
}

function AlertsView({ toast }: { toast: (s: string) => void }) {
  const init = getSettings();
  const [phone, setPhone] = useState(init.whatsappPhone || '');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(init.whatsappKeySet);
  const field = 'mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 transition focus:border-ice';
  const save = () => { patchSettings({ whatsappPhone: phone, whatsappKey: key }); setKey(''); setSaved(getSettings().whatsappKeySet); toast('WhatsApp details saved.'); };
  const test = async () => { const ok = await notifyTest(); toast(ok ? 'Test message sent. Check WhatsApp (it can take a minute).' : 'Not sent. Save your number and key first.'); };
  return (
    <div data-reveal className="max-w-3xl rounded-2xl border border-line bg-card p-6">
      <h2 className="font-display text-2xl font-extrabold">WhatsApp alerts</h2>
      <p className="mt-1 text-sm text-muted">There are two ways to get job alerts on WhatsApp. The first needs no setup.</p>
      <h3 className="mt-4 font-display font-bold">Option 1: One tap, no setup</h3>
      <p className="text-sm text-muted">After a scan finds new jobs, a button appears on the Best matches page. Tap it and WhatsApp opens with the jobs ready to send to yourself. This uses WhatsApp's own link feature and shares nothing with anyone else.</p>
      <h3 className="mt-4 font-display font-bold">Option 2: Automatic messages (free, set up once)</h3>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>On your phone, open <b>callmebot.com/blog/free-api-whatsapp-messages</b> and save the WhatsApp number shown there as a contact.</li>
        <li>In WhatsApp, send that contact this message: <b>I allow callmebot to send me messages</b></li>
        <li>Wait for its reply. It contains your key.</li>
        <li>Enter your number (country code first, no plus sign, for example 919876543210) and the key below, then press Save.</li>
        <li>Press <b>Send a test message</b> to check that it works.</li>
      </ol>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Your WhatsApp number<input className={field} value={phone} placeholder="919876543210" onChange={e => setPhone(e.target.value)} /></label>
        <label className="block text-sm font-semibold">CallMeBot key {saved && <span className="font-normal text-good">(saved)</span>}
          <input type="password" className={field} value={key} placeholder={saved ? 'Leave blank to keep the saved key' : 'Paste key'} onChange={e => setKey(e.target.value)} autoComplete="off" /></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={save} className="rounded-full bg-bloom px-5 py-2.5 text-sm font-semibold text-white hover:bg-bloom-hover">Save</button>
        <button onClick={test} className="rounded-full border border-ice px-5 py-2.5 text-sm font-semibold text-ice hover:bg-bloom-soft">Send a test message</button>
      </div>
      <p className="mt-3 text-xs text-muted">The site cannot confirm that a message arrived, so check WhatsApp after pressing the test button. Option 2 uses CallMeBot, a free service made for personal use. It is not run by WhatsApp, and your number, key and the job titles pass through it. Use Option 1 if you would rather not share that.</p>
    </div>
  );
}

function Heat({ text, terms, resume }: { text: string; terms: string[]; resume: string }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp('(?<![a-z0-9])(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|') + ')(?![a-z0-9])', 'gi');
  return <>{text.split(re).map((part, i) => i % 2 === 1
    ? <mark key={i} className={hasTerm(resume, part) ? 'rounded bg-green-500/25 px-0.5 text-green-300' : 'rounded bg-rose-500/25 px-0.5 text-rose-300'}>{part}</mark>
    : part)}</>;
}

function HiringView({ jd, resume, extra }: { jd: string; resume: string; extra: string[] }) {
  if (!resume.trim()) return <p className="mt-5 rounded-xl border border-line bg-paper p-4 text-sm text-muted">Paste your CV text in the CV & details tab first. Then this view shows how a recruiter would scan your CV against this job.</p>;
  const terms = Array.from(new Set([...TA_TERMS, ...extra].filter(t => t && hasTerm(jd, t))));
  const got = terms.filter(t => hasTerm(resume, t)); const miss = terms.filter(t => !hasTerm(resume, t));
  const pct = terms.length ? Math.round((got.length / terms.length) * 100) : 0;
  return (
    <div className="fade mt-5">
      <p className="text-sm text-muted">This is roughly what a recruiter looks for in the first few seconds. Green means the word is in your CV, red means it is missing.</p>
      <div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-paper"><div className="bar h-full rounded-full bg-good" style={{ width: `${pct}%` }} /></div><span className="font-display font-bold">{pct}% of key words</span></div>
      {miss.length > 0 && <p className="mt-3 text-sm">Missing: {miss.map(m => <span key={m} className="mr-1 inline-block rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">{m}</span>)}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div><h4 className="mb-1 font-display font-bold">Job description</h4><p className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-sm leading-relaxed">{<Heat text={jd.slice(0, 6000)} terms={terms} resume={resume} />}</p></div>
        <div><h4 className="mb-1 font-display font-bold">Your CV</h4><p className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-sm leading-relaxed">{<Heat text={resume.slice(0, 6000)} terms={got} resume={resume} />}</p></div>
      </div>
      <p className="mt-2 text-xs text-muted">Only add a missing word if it is true for you.</p>
    </div>
  );
}

function InterviewPrep({ jd }: { jd: string }) {
  const hits = INTERVIEW_PREP.filter(p => p.re.test(jd)).map(p => p.q).slice(0, 5);
  const qs = hits.length ? hits : INTERVIEW_PREP.slice(0, 3).map(p => p.q);
  return (
    <div className="fade mt-5 space-y-3">
      <p className="text-sm text-muted">Likely questions based on the words in this job. Build your answers from your own real experience.</p>
      {qs.map(q => (
        <details key={q} className="rounded-xl border border-line bg-paper p-4">
          <summary className="cursor-pointer font-display font-bold">{q}</summary>
          <ul className="mt-3 space-y-1 text-sm">
            <li><b className="text-ice">Situation:</b> [Where and when was this, and what was the hiring problem?]</li>
            <li><b className="text-ice">Task:</b> [What were you responsible for, and what was the target?]</li>
            <li><b className="text-ice">Action:</b> [Two or three specific steps you took]</li>
            <li><b className="text-ice">Result:</b> [Real numbers: days saved, % cost cut, hires made]</li>
          </ul>
        </details>
      ))}
    </div>
  );
}

function CheckJob({ profile, extra }: { profile: Profile; extra: string[] }) {
  const [jd, setJd] = useState('');
  return (
    <div className="max-w-5xl space-y-6">
      <div data-reveal className="rounded-2xl border border-line bg-card p-6">
        <h2 className="font-display text-2xl font-extrabold">Check any job</h2>
        <p className="mt-1 text-sm text-muted">Found a job on LinkedIn or a company site? Copy its description and paste it here to see how your CV matches and which interview questions to expect. Nothing is sent anywhere.</p>
        <textarea rows={8} className="mt-3 w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-sm transition focus:border-ice" value={jd} placeholder="Paste the job description here" onChange={e => setJd(e.target.value)} />
      </div>
      {jd.trim().length > 40 && <div className="rounded-2xl border border-line bg-card p-6"><HiringView jd={jd} resume={profile.resume} extra={extra} /><InterviewPrep jd={jd} /></div>}
    </div>
  );
}

function Outreach({ job, profile }: { job: Job; profile: Profile }) {
  const co = job.company.charAt(0).toUpperCase() + job.company.slice(1);
  const me = profile.name || '[Your name]';
  const people = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
  const tpl = {
    inmail: `Hi [Name], I'm ${me}, a talent acquisition professional who [cut time-to-fill from X to Y days, or reduced agency spend by Z%]. I saw that ${co} is hiring a ${job.title} and would love to share how I would approach it. Could we speak for 15 minutes this week? Thank you, ${me}`,
    peer: `Hey [Name], I saw that the talent team at ${co} is growing. I work in talent acquisition too ([your focus, such as tech or leadership hiring]) and would love to hear what the team is like. Open to a quick chat?`,
    follow: `Hi [Name], I applied for the ${job.title} role at ${co} on [date] and wanted to check in. [One new thing since you applied, such as a result or project]. I am still very interested and happy to share more. Thank you!`,
  };
  const [kind, setKind] = useState<'inmail' | 'peer' | 'follow'>('inmail');
  const [text, setText] = useState('');
  useEffect(() => { setText(tpl[kind]); }, [job.canonical_url, profile.name, kind]);
  const blanks = (text.match(/\[[^\]]*\]/g) || []).length;
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  let days: number | null = null;
  try { const t = JSON.parse(localStorage.getItem('jr_applied_at') || '{}')[job.canonical_url]; if (t) days = Math.floor((Date.now() - t) / DAY); } catch {}
  const tabs: ['inmail' | 'peer' | 'follow', string][] = [['inmail', 'InMail to Head of Talent'], ['peer', 'Peer message'], ['follow', 'Follow-up']];
  return (
    <div data-reveal className="mt-5 rounded-xl border border-line bg-paper p-4">
      <h3 className="font-display font-bold">Reach a real person</h3>
      <p className="mt-1 text-sm text-muted">A message to a recruiter or team member often works better than a cold application.</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
        <a href={people(`talent acquisition ${co}`)} target="_blank" rel="noreferrer" className="rounded-full border border-ice px-3 py-1.5 text-ice hover:bg-bloom-soft">Recruiters at {co}</a>
        <a href={people(`head of talent acquisition ${co}`)} target="_blank" rel="noreferrer" className="rounded-full border border-ice px-3 py-1.5 text-ice hover:bg-bloom-soft">TA leaders at {co}</a>
        <a href={people(`${co} India`)} target="_blank" rel="noreferrer" className="rounded-full border border-ice px-3 py-1.5 text-ice hover:bg-bloom-soft">People at {co} in India</a>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1.5 ${kind === k ? 'bg-bloom text-white' : 'border border-line text-muted hover:text-white'}`}>{l}</button>)}
      </div>
      {kind === 'follow' && <p className="mt-2 text-xs text-muted">{days === null ? 'Best sent about 5 days after you apply. Mark the job as applied to track the days.' : days >= 5 ? `You applied ${days} days ago, so this is a good time to follow up.` : `You applied ${days} day(s) ago. Wait until day 5 to follow up.`}</p>}
      <textarea rows={6} value={text} onChange={e => setText(e.target.value)} className="mt-3 w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm transition focus:border-ice" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className={blanks ? 'text-warn' : 'text-good'}>{blanks ? `${blanks} [blank] still to fill in with your own words` : 'Looks ready. Read it once more before sending.'} · {text.length} characters</span>
        <button onClick={copy} className="rounded-full bg-bloom px-4 py-1.5 font-semibold text-white hover:bg-bloom-hover">{copied ? 'Copied' : 'Copy message'}</button>
      </div>
      <p className="mt-2 text-xs text-muted">LinkedIn connection notes are short, so use this as a message after connecting.</p>
    </div>
  );
}

function Block({ icon, title, items, empty }: { icon: React.ReactNode; title: string; items: string[]; empty: string }) {
  return (
    <div data-reveal className="mt-5">
      <h3 className="flex items-center gap-2 font-display font-bold">{icon}{title}</h3>
      {items?.length ? <ul className="mt-2 space-y-1 text-sm">{items.map((x, i) => <li key={i} className="rounded-lg bg-paper px-3 py-1.5">{x}</li>)}</ul> : <p className="mt-1 text-sm text-muted">{empty}</p>}
    </div>
  );
}

const listFields: [string, string][] = [
  ['target_titles', 'Job titles I want'], ['title_keywords', 'Words that must be in the job title (any one)'], ['must_have_keywords', 'Skills and keywords I want to see'],
  ['avoid_keywords', 'Words that should lower the score'], ['blocklist_companies', 'Companies to hide (their jobs disappear right away)'], ['extra_companies', 'Extra companies to scan (the name in their Greenhouse job link, for example cloudflare)'],
];

function PrefsView({ prefs, setPrefs, toast }: { prefs: Prefs | null; setPrefs: (p: Prefs) => void; toast: (s: string) => void }) {
  const [saving, setSaving] = useState(false);
  if (!prefs) return <div className="skel h-64 max-w-3xl" />;
  const set = (k: string, v: any) => setPrefs({ ...prefs, [k]: v });
  const save = async () => {
    setSaving(true);
    try { const r = { ok: savePrefs(prefs) }; toast(r.ok ? 'Preferences saved. Scan again to re-score jobs.' : 'Could not save preferences.'); }
    catch { toast('Could not reach the server.'); }
    setSaving(false);
  };
  const field = 'mt-1 w-full rounded-xl border border-line bg-card px-3 py-2.5 transition focus:border-bloom';
  return (
    <div data-reveal className="max-w-3xl rounded-2xl border border-line bg-card p-6">
      <h2 className="font-display text-2xl font-extrabold">My preferences</h2>
      <p className="mt-1 text-sm text-muted">Separate items with commas. Salary is a minimum only, and a missing salary never hides a job.</p>
      <div className="mt-5 space-y-4">
        {listFields.map(([k, label]) => (
          <label key={k} className="block text-sm font-semibold">{label}
            <textarea rows={2} className={field} defaultValue={(prefs[k] || []).join(', ')} onChange={e => set(k, e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
          </label>
        ))}
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm font-semibold">Minimum salary (LPA)<input type="number" className={field} value={prefs.salary_floor_lpa ?? 0} onChange={e => set('salary_floor_lpa', Number(e.target.value))} /></label>
          <label className="block text-sm font-semibold">Bonus for MNC/GCC (0 to 30)<input type="number" min={0} max={30} className={field} value={prefs.mnc_weight ?? 20} onChange={e => set('mnc_weight', Number(e.target.value))} /></label>
          <label className="block text-sm font-semibold">Work setup
            <select className={field} value={prefs.work_setup || 'any'} onChange={e => set('work_setup', e.target.value)}>
              <option value="hybrid">Hybrid</option><option value="remote">Remote</option><option value="onsite">On-site</option><option value="any">Any</option>
            </select></label>
        </div>
      </div>
      <button onClick={saving ? undefined : save} className="mt-6 rounded-full bg-bloom px-6 py-2.5 font-semibold text-white hover:bg-bloom-hover disabled:opacity-60" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
    </div>
  );
}

function SourcesView({ health }: { health: Record<string, any> }) {
  const rows = Object.values(health);
  const [res, setRes] = useState('');
  const test = async () => {
    setRes('Sending…');
    try { const r = { ok: await notifyTest() }; setRes(r.ok ? 'Sent. Check WhatsApp (it can take a minute).' : 'Not sent. Add your WhatsApp details in the Settings tab first.'); }
    catch { setRes('Could not reach the server.'); }
  };
  return (
    <div data-reveal className="max-w-3xl rounded-2xl border border-line bg-card p-6">
      <h2 className="font-display text-2xl font-extrabold">Sources</h2>
      <p className="mt-1 text-sm text-muted">Where jobs come from, and whether each source worked on its last run.</p>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">No source has run yet. Press “Scan for new jobs” first.</p> : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((r: any) => (
            <li key={r.source + r.company} className="flex items-center justify-between py-3 text-sm">
              <span><b className="font-display capitalize">{r.company}</b> <span className="text-muted">on {r.source}</span></span>
              <span className={r.status === 'healthy' ? 'font-semibold text-good' : 'font-semibold text-bad'}>{r.status === 'healthy' ? `${r.jobsFound} of ${r.openings ?? '?'} openings` : (r.error || 'Failed')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
