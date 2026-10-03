// All job scanning runs inside the browser. Data is stored in this browser only (localStorage).
export type Prefs = Record<string, any>;
const read = (k: string, d: any) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: any): boolean => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const DEFAULT_COMPANIES = ['asana', 'lyft', 'doordash', 'reddit', 'discord', 'duolingo', 'figma', 'hubspot', 'newrelic', 'pagerduty', 'amplitude', 'grammarly', 'gusto', 'carta', 'brex', 'plaid', 'affirm', 'nerdwallet', 'squarespace', 'zendesk', 'postman', 'razorpay', 'browserstack', 'druva', 'stripe', 'twilio', 'datadog', 'elastic', 'gitlab', 'canonical', 'airbnb', 'okta', 'rubrik', 'cloudflare', 'mongodb', 'pinterest', 'dropbox', 'databricks', 'coinbase'];
export const DEFAULT_PREFS: Prefs = {
  version: 3,
  target_titles: ['Talent Acquisition Manager', 'Senior Talent Acquisition Partner', 'Talent Acquisition Lead', 'Recruitment Manager', 'Head of Talent Acquisition', 'Senior Recruiter'],
  title_keywords: ['talent acquisition', 'recruit', 'talent partner', 'sourcer', 'talent', 'hiring', 'staffing', 'workforce', 'human resources', 'people partner', 'people operations', 'hr'],
  location: { primary: ['Bengaluru', 'Bangalore'], allow_remote_india: true, allow_other_india: true, allow_hybrid: true },
  salary_floor_lpa: 18, mnc_weight: 20, work_setup: 'hybrid',
  must_have_keywords: ['Talent Acquisition', 'Sourcing', 'Stakeholder', 'ATS', 'Hiring', 'Workforce Planning'],
  avoid_keywords: ['6 days working', 'walk-in', 'pay to apply', 'commission only', 'bond period', 'night shift'],
  blocklist_companies: [] as string[],
};

export const loadPrefs = (): Prefs => { const p = read('jr_prefs', null); return p && p.version === 3 ? p : DEFAULT_PREFS; };
export const savePrefs = (p: Prefs) => write('jr_prefs', { ...p, version: 3 });
export const loadJobs = (): any[] => read('jr_jobs', []);
export const loadHealth = (): Record<string, any> => read('jr_health', {});
export const lastScanTime = (): number => Number(read('jr_last_scan', 0));

const settings = () => ({ companies: DEFAULT_COMPANIES, everyHours: 6, whatsappPhone: '', whatsappKey: '', ...read('jr_settings', {}) });
export const getSettings = () => { const s = settings(); return { companies: s.companies as string[], everyHours: s.everyHours as number, whatsappPhone: s.whatsappPhone as string, whatsappKeySet: !!s.whatsappKey, whatsappVerified: !!s.whatsappVerified }; };
export const patchSettings = (b: any) => {
  const cur = read('jr_settings', {});
  if (Array.isArray(b.companies)) cur.companies = b.companies.map((x: any) => String(x).toLowerCase().trim()).filter((x: string) => /^[a-z0-9_-]{2,40}$/.test(x));
  if (b.everyHours) cur.everyHours = Math.min(48, Math.max(1, Number(b.everyHours)));
  if (typeof b.whatsappPhone === 'string') { const p = b.whatsappPhone.replace(/\D/g, ''); if (p !== cur.whatsappPhone) cur.whatsappVerified = false; cur.whatsappPhone = p; }
  if (typeof b.whatsappKey === 'string' && b.whatsappKey.trim()) { cur.whatsappKey = b.whatsappKey.trim(); }
  write('jr_settings', cur);
};

const API = 'https://boards-api.greenhouse.io/v1/boards';
const decode = (s: string) => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent || '';
const stripHtml = (raw: string) => decode(decode(raw).replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

async function fetchBoard(slug: string): Promise<{ ok: boolean; list: any[]; error?: string }> {
  try {
    const r = await fetch(`${API}/${slug}/jobs`);
    if (!r.ok) return { ok: false, list: [], error: r.status === 404 ? 'Job board not found' : `Error ${r.status}` };
    const d = await r.json();
    const list = (d.jobs || []).map((j: any) => {
      const loc = j.location?.name || ''; const low = loc.toLowerCase();
      return { id: j.id, title: String(j.title || '').trim(), location_normalized: loc || 'Location not stated', canonical_url: String(j.absolute_url || '').split('?')[0], is_bengaluru: /bengaluru|bangalore/.test(low), is_remote: low.includes('remote') };
    }).filter((j: any) => j.canonical_url);
    return { ok: true, list };
  } catch { return { ok: false, list: [], error: 'Blocked by the browser or no internet' }; }
}
export async function checkCompany(slug: string) { const r = await fetchBoard(slug); return { ok: r.ok, total: r.list.length }; }

async function fetchContent(slug: string, id: number): Promise<string> {
  try { const r = await fetch(`${API}/${slug}/jobs/${id}`); return r.ok ? stripHtml((await r.json()).content || '').slice(0, 6000) : ''; } catch { return ''; }
}

const has = (t: string, k: string) => {
  const q = k.toLowerCase().trim();
  if (!q) return false;
  return q.length <= 3 ? new RegExp(`\\b${q.replace(/[^a-z0-9]/g, '')}\\b`).test(t) : t.includes(q);
};
const INDIA = /india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|gurgaon|gurugram|noida|kolkata|ahmedabad/;

function passes(job: any, prefs: any): boolean {
  const title = job.title.toLowerCase();
  if (![...(prefs.title_keywords || []), ...(prefs.target_titles || [])].some((k: string) => k && has(title, k))) return false;
  const loc = job.location_normalized.toLowerCase();
  if (prefs.location?.allow_outside_india === false && !(job.is_bengaluru || INDIA.test(loc))) return false;
  return !(prefs.blocklist_companies || []).some((b: string) => b && has(job.company.toLowerCase(), b));
}

function score(job: any, prefs: any) {
  const title = job.title.toLowerCase(); const text = `${title} ${(job.content_text || '').toLowerCase()}`;
  let s = 0; const matched: string[] = [], flags: string[] = [], unknown: string[] = [];
  const exact = (prefs.target_titles || []).some((t: string) => t && has(title, t));
  s += exact ? 30 : 20; matched.push(exact ? 'Title matches your target roles (+30)' : 'Title is in the recruiting family (+20)');
  if (job.is_bengaluru) { s += 20; matched.push('Bengaluru office (+20)'); } else if (INDIA.test(job.location_normalized.toLowerCase())) { s += job.is_remote ? 10 : 8; matched.push(job.is_remote ? 'Remote in India (+10)' : 'Another city in India (+8)'); } else { unknown.push('Location is outside India. Check that you can work from India.'); }
  const mnc = Number(prefs.mnc_weight ?? 20); s += mnc; matched.push(`MNC/Tier-1 allowlist match for ${job.company} (+${mnc})`);
  if (/\b(manager|lead|head|director|principal)\b/.test(title)) { s += 10; matched.push('Senior title (+10)'); }
  const hits = (prefs.must_have_keywords || []).filter((k: string) => k && has(text, k));
  if (hits.length) { const pts = Math.min(20, hits.length * 5); s += pts; matched.push(`Keywords: ${hits.join(', ')} (+${pts})`); }
  if (text.includes('hybrid')) { s += 5; matched.push('Hybrid mentioned (+5)'); }
  for (const a of prefs.avoid_keywords || []) if (a && has(text, a)) { s -= 10; flags.push(`Avoid keyword: "${a}" (-10)`); }
  const yrs = /(\d{1,2})\s*\+?\s*(years|yrs)/.test(text);
  if (!yrs) unknown.push('Years of experience not stated');
  if (!/lpa|salary|compensation|ctc/.test(text)) unknown.push('Salary not stated');
  s = Math.min(100, Math.max(0, s));
  return { ...job, score: s, matched_criteria: matched, red_flags: flags, unknown_fields: unknown, status: yrs ? 'discovered' : 'review', why_apply: s >= 70 ? 'Strong match: right role type, location and company.' : 'Possible match. Read the details first.' };
}

async function send(text: string): Promise<boolean> {
  const st = settings();
  if (!st.whatsappPhone || !st.whatsappKey || !st.whatsappVerified) return false;
  try {
    // no-cors: the request goes through even though the browser cannot read the reply
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${st.whatsappPhone}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(st.whatsappKey)}`, { mode: 'no-cors' });
    return true;
  } catch { return false; }
}
// Official one-tap WhatsApp link (works without any setup)
export const waLink = (text: string) => `https://wa.me/${settings().whatsappPhone || ''}?text=${encodeURIComponent(text)}`;
export const notifyTest = () => send('Test message: your job site is connected to WhatsApp.');

let scanning = false;
export async function runScan() {
  if (scanning) return { busy: true, companiesScanned: 0, totalRawFetched: 0, totalJobsInDatabase: 0, bengaluruJobs: 0, notified: false, removed: [] as string[], digest: '' };
  scanning = true;
  try {
    const prefs = loadPrefs(); const prev = loadJobs(); const prevMap = new Map(prev.map(j => [j.canonical_url, j]));
    const health = loadHealth(); const now = new Date().toISOString();
    const companies = Array.from(new Set([...DEFAULT_COMPANIES, ...((prefs.extra_companies || []) as string[]).map(x => String(x).toLowerCase().trim().replace(/[^a-z0-9_-]/g, '')).filter(Boolean)]));
    const kept: any[] = []; const seen = new Set<string>(); let fetched = 0; const removed: string[] = [];
    const boards = await Promise.all(companies.map(c => fetchBoard(c)));
    for (let ci = 0; ci < companies.length; ci++) {
      const c = companies[ci]; const r = boards[ci]; const key = `greenhouse:${c}`;
      if (!r.ok) { health[key] = { source: 'greenhouse', company: c, status: 'error', error: r.error, lastRun: now, jobsFound: 0 }; kept.push(...prev.filter(j => j.company_slug === c)); continue; }
      fetched += r.list.length; let shown = 0; const name = c.charAt(0).toUpperCase() + c.slice(1);
      const passing: any[] = [];
      for (const j of r.list) {
        const job = { ...j, company: name };
        const dk = `${c}|${job.title}|${job.location_normalized}`.toLowerCase();
        if (!passes(job, prefs) || seen.has(dk)) continue;
        seen.add(dk); passing.push(job);
      }
      const contents = await Promise.all(passing.map(j => fetchContent(c, j.id)));
      passing.forEach((job, k) => kept.push({ ...score({ ...job, content_text: contents[k] }, prefs), company_slug: c, first_seen: prevMap.get(job.canonical_url)?.first_seen || now }));
      shown = passing.length;
      health[key] = { source: 'greenhouse', company: c, status: 'healthy', lastRun: now, jobsFound: shown, openings: r.list.length };
    }
    kept.sort((a, b) => b.score - a.score);
    write('jr_jobs', kept); write('jr_health', health); write('jr_last_scan', Date.now());
    const fresh = kept.filter(j => j.first_seen === now && j.score >= 60).slice(0, 5);
    const digest = fresh.length ? `${fresh.length} new job${fresh.length > 1 ? 's' : ''} matching your search:\n\n` + fresh.map(j => `• ${j.title} at ${j.company} (${j.score}/100)\n${j.canonical_url}`).join('\n\n') : '';
    let notified = false;
    if (digest) notified = await send(digest);
    return { busy: false, removed, digest, companiesScanned: companies.length, totalRawFetched: fetched, totalJobsInDatabase: kept.length, bengaluruJobs: kept.filter(j => j.is_bengaluru).length, notified };
  } finally { scanning = false; }
}

export const inIndia = (loc: string) => INDIA.test(loc.toLowerCase());

// ---------- Recruiter-focused helpers (all rule-based, nothing leaves the browser) ----------
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const hasTerm = (text: string, term: string) => new RegExp('(?<![a-z0-9])' + esc(term.toLowerCase()) + '(?![a-z0-9])', 'i').test(text);

export const TA_TERMS = ['talent acquisition', 'full lifecycle', 'full-cycle', 'sourcing', 'boolean search', 'linkedin recruiter', 'greenhouse', 'lever', 'workday', 'taleo', 'icims', 'smartrecruiters', 'ashby', 'ats', 'stakeholder', 'hiring manager', 'workforce planning', 'headcount', 'time to fill', 'time-to-fill', 'cost per hire', 'cost-per-hire', 'offer acceptance', 'employer branding', 'campus hiring', 'executive search', 'headhunting', 'diversity', 'vendor management', 'agency', 'recruitment marketing', 'pipeline', 'onboarding', 'analytics', 'budget', 'offer negotiation', 'compensation', 'high-volume', 'technical hiring', 'leadership hiring', 'talent mapping', 'referral', 'metrics'];

const METRIC_RULES: [string, RegExp, boolean][] = [
  ['Cost-per-hire reduction', /cost|agency|spend|budget|saving|saved|fees/i, true],
  ['Time-to-fill efficiency', /time[- ]to[- ](fill|hire)|days|cycle|turnaround/i, true],
  ['High-volume or niche hiring', /hired|hires|headcount|scaled|closed|positions|requisitions|offers/i, true],
  ['ATS and tools', /greenhouse|lever|workday|taleo|icims|smartrecruiters|ashby|linkedin recruiter|\bats\b/i, false],
  ['Stakeholder management', /\bvp\b|vice president|c-suite|cxo|\bceo\b|\bcto\b|director|head of|leadership|stakeholder|hiring manager/i, false],
];
export function analyzeMetrics(text: string) {
  const parts = text.split(/[\n.;\u2022]+/);
  return METRIC_RULES.map(([label, re, needNum]) => ({ label, ok: !!text.trim() && parts.some(x => re.test(x) && (!needNum || /\d/.test(x))) }));
}

export const INTERVIEW_PREP: { re: RegExp; q: string }[] = [
  { re: /scal|grow|headcount|expan|ramp/i, q: 'The role involves scaling headcount. How do you build a sourcing strategy when hiring managers are slow to give feedback?' },
  { re: /stakeholder|business leader|\bvp\b|leadership|c-suite/i, q: 'How do you align a hiring manager who keeps changing the job requirements in the middle of a search?' },
  { re: /\bats\b|greenhouse|lever|workday|automation|data/i, q: 'Tell me about a time you used data from your ATS to change how you hire.' },
  { re: /time[- ]to[- ]fill|speed|efficien|cycle/i, q: 'Walk me through how you reduced time-to-fill for a role that was hard to fill.' },
  { re: /cost|budget|agency|vendor/i, q: 'How have you reduced agency spend or cost per hire without lowering quality?' },
  { re: /diversity|inclusion|equity/i, q: 'How do you build diverse candidate slates without slowing the process down?' },
  { re: /campus|university|early career|graduate|intern/i, q: 'How would you plan a campus hiring drive, from first contact to accepted offer?' },
  { re: /employer brand|branding|marketing/i, q: 'How do you make the company stand out to candidates who hold several offers?' },
  { re: /executive|senior leadership|head of|director/i, q: 'How do you run a confidential senior search and keep the pipeline warm?' },
  { re: /volume|hundreds|mass hiring/i, q: 'How do you keep quality high while hiring 100 or more people in a quarter?' },
  { re: /offer|negotiat|compensation|closing/i, q: 'Tell me about an offer you almost lost. How did you save it?' },
];

// ---------- Encrypted backup (password never leaves the browser) ----------
const toB64 = (buf: ArrayBuffer) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000))); return btoa(s); };
const fromB64 = (x: string) => Uint8Array.from(atob(x), c => c.charCodeAt(0));
async function keyFrom(pw: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBackup(pw: string): Promise<string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('jr_')) o[k] = localStorage.getItem(k) || ''; }
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pw, salt), new TextEncoder().encode(JSON.stringify(o)));
  return JSON.stringify({ v: 1, salt: toB64(salt.buffer as ArrayBuffer), iv: toB64(iv.buffer as ArrayBuffer), data: toB64(data) });
}
export async function restoreBackup(text: string, pw: string) {
  const f = JSON.parse(text);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.iv) as BufferSource }, await keyFrom(pw, fromB64(f.salt)), fromB64(f.data) as BufferSource);
  const o = JSON.parse(new TextDecoder().decode(plain));
  Object.entries(o).forEach(([k, v]) => { if (k.startsWith('jr_')) localStorage.setItem(k, String(v)); });
}

export const callMeBotUrl = (text: string) => { const st = settings(); return st.whatsappPhone && st.whatsappKey ? `https://api.callmebot.com/whatsapp.php?phone=${st.whatsappPhone}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(st.whatsappKey)}` : ''; };

// ---------- WhatsApp code check: proves the number and key can receive messages ----------
export async function sendVerifyCode(): Promise<boolean> {
  const st = settings();
  if (!st.whatsappPhone || !st.whatsappKey) return false;
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  write('jr_wa_code', { code, exp: Date.now() + 10 * 60 * 1000 });
  try { await fetch(callMeBotUrl(`Your job site verification code is ${code}`), { mode: 'no-cors' }); return true; } catch { return false; }
}
export function checkVerifyCode(input: string): boolean {
  const c = read('jr_wa_code', null);
  if (!c || Date.now() > c.exp || input.trim() !== c.code) return false;
  const cur = read('jr_settings', {}); cur.whatsappVerified = true; write('jr_settings', cur);
  try { localStorage.removeItem('jr_wa_code'); } catch {}
  return true;
}
export function clearWhatsapp() {
  const cur = read('jr_settings', {}); delete cur.whatsappPhone; delete cur.whatsappKey; delete cur.whatsappVerified; write('jr_settings', cur);
}

// Zero-setup number check: opens WhatsApp with a code already written for her to send to herself
export function startPhoneCheck(): string {
  const st = settings();
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  write('jr_wa_code', { code, exp: Date.now() + 10 * 60 * 1000 });
  return `https://wa.me/${st.whatsappPhone}?text=${encodeURIComponent(`Your job site code is ${code}`)}`;
}

// Browser notification when a scan finds new matching jobs (only works while the site is open)
export function browserNotify(digest: string) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const parts = digest.split('\n\n');
    new Notification(parts[0].replace(/:$/, ''), { body: parts.slice(1, 4).map(p => p.split('\n')[0]).join('\n') });
  } catch {}
}
