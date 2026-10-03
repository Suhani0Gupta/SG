// All job scanning runs inside the browser. Data is stored in this browser only (localStorage).
export type Prefs = Record<string, any>;
const read = (k: string, d: any) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: any): boolean => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const DEFAULT_COMPANIES = ['stripe', 'twilio', 'datadog', 'elastic', 'gitlab', 'canonical', 'airbnb', 'okta', 'rubrik', 'cloudflare', 'mongodb', 'pinterest', 'dropbox', 'databricks', 'coinbase'];
export const DEFAULT_PREFS: Prefs = {
  version: 2,
  target_titles: ['Talent Acquisition Manager', 'Senior Talent Acquisition Partner', 'Talent Acquisition Lead', 'Recruitment Manager', 'Head of Talent Acquisition', 'Senior Recruiter'],
  title_keywords: ['talent acquisition', 'recruit', 'talent partner', 'sourcer'],
  location: { primary: ['Bengaluru', 'Bangalore'], allow_remote_india: true, allow_hybrid: true },
  salary_floor_lpa: 18, mnc_weight: 20, work_setup: 'hybrid',
  must_have_keywords: ['Talent Acquisition', 'Sourcing', 'Stakeholder', 'ATS', 'Hiring', 'Workforce Planning'],
  avoid_keywords: ['6 days working', 'walk-in', 'pay to apply', 'commission only', 'bond period', 'night shift'],
  blocklist_companies: [] as string[],
};

export const loadPrefs = (): Prefs => { const p = read('jr_prefs', null); return p && p.version === 2 ? p : DEFAULT_PREFS; };
export const savePrefs = (p: Prefs) => write('jr_prefs', { ...p, version: 2 });
export const loadJobs = (): any[] => read('jr_jobs', []);
export const loadHealth = (): Record<string, any> => read('jr_health', {});
export const lastScanTime = (): number => Number(read('jr_last_scan', 0));

const settings = () => ({ companies: DEFAULT_COMPANIES, everyHours: 6, telegramToken: '', telegramChatId: '', ...read('jr_settings', {}) });
export const getSettings = () => { const s = settings(); return { companies: s.companies as string[], everyHours: s.everyHours as number, telegramChatId: s.telegramChatId as string, telegramTokenSet: !!s.telegramToken }; };
export const patchSettings = (b: any) => {
  const cur = read('jr_settings', {});
  if (Array.isArray(b.companies)) cur.companies = b.companies.map((x: any) => String(x).toLowerCase().trim()).filter((x: string) => /^[a-z0-9_-]{2,40}$/.test(x));
  if (b.everyHours) cur.everyHours = Math.min(48, Math.max(1, Number(b.everyHours)));
  if (typeof b.telegramToken === 'string' && b.telegramToken.trim()) cur.telegramToken = b.telegramToken.trim();
  if (typeof b.telegramChatId === 'string') cur.telegramChatId = b.telegramChatId.trim();
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

const has = (t: string, k: string) => t.includes(k.toLowerCase());

function passes(job: any, prefs: any): boolean {
  const title = job.title.toLowerCase();
  if (![...(prefs.title_keywords || []), ...(prefs.target_titles || [])].some((k: string) => k && has(title, k))) return false;
  const loc = job.location_normalized.toLowerCase();
  if (!(job.is_bengaluru || (prefs.location?.allow_remote_india && loc.includes('india') && (job.is_remote || loc.includes('hybrid'))))) return false;
  return !(prefs.blocklist_companies || []).some((b: string) => b && has(job.company.toLowerCase(), b));
}

function score(job: any, prefs: any) {
  const title = job.title.toLowerCase(); const text = `${title} ${(job.content_text || '').toLowerCase()}`;
  let s = 0; const matched: string[] = [], flags: string[] = [], unknown: string[] = [];
  const exact = (prefs.target_titles || []).some((t: string) => t && has(title, t));
  s += exact ? 30 : 20; matched.push(exact ? 'Title matches your target roles (+30)' : 'Title is in the recruiting family (+20)');
  if (job.is_bengaluru) { s += 20; matched.push('Bengaluru office (+20)'); } else { s += 10; matched.push('Remote or hybrid in India (+10)'); }
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
  if (!st.telegramToken || !st.telegramChatId) return false;
  try {
    // no-cors: the message is delivered even though the browser cannot read Telegram's reply
    await fetch(`https://api.telegram.org/bot${st.telegramToken}/sendMessage`, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ chat_id: st.telegramChatId, text, disable_web_page_preview: 'true' }) });
    return true;
  } catch { return false; }
}
export const notifyTest = () => send('Test message: your job site is connected to Telegram.');

let scanning = false;
export async function runScan() {
  if (scanning) return { busy: true, companiesScanned: 0, totalRawFetched: 0, totalJobsInDatabase: 0, bengaluruJobs: 0, notified: false };
  scanning = true;
  try {
    const prefs = loadPrefs(); const prev = loadJobs(); const prevMap = new Map(prev.map(j => [j.canonical_url, j]));
    const health = loadHealth(); const now = new Date().toISOString();
    const companies = settings().companies as string[];
    const kept: any[] = []; const seen = new Set<string>(); let fetched = 0;
    for (const c of companies) {
      const r = await fetchBoard(c); const key = `greenhouse:${c}`;
      if (!r.ok) { health[key] = { source: 'greenhouse', company: c, status: 'error', error: r.error, lastRun: now, jobsFound: 0 }; kept.push(...prev.filter(j => j.company_slug === c)); continue; }
      fetched += r.list.length; let shown = 0; const name = c.charAt(0).toUpperCase() + c.slice(1);
      for (const j of r.list) {
        const job = { ...j, company: name };
        const dk = `${c}|${job.title}|${job.location_normalized}`.toLowerCase();
        if (!passes(job, prefs) || seen.has(dk)) continue;
        seen.add(dk); shown++;
        const content_text = await fetchContent(c, j.id);
        kept.push({ ...score({ ...job, content_text }, prefs), company_slug: c, first_seen: prevMap.get(job.canonical_url)?.first_seen || now });
      }
      health[key] = { source: 'greenhouse', company: c, status: 'healthy', lastRun: now, jobsFound: shown };
    }
    kept.sort((a, b) => b.score - a.score);
    write('jr_jobs', kept); write('jr_health', health); write('jr_last_scan', Date.now());
    const fresh = kept.filter(j => j.first_seen === now && j.score >= 60).slice(0, 5);
    let notified = false;
    if (fresh.length) notified = await send(`${fresh.length} new job${fresh.length > 1 ? 's' : ''} matching your search:\n` + fresh.map(j => `• ${j.title} at ${j.company} (${j.score}/100)\n${j.canonical_url}`).join('\n'));
    return { busy: false, companiesScanned: companies.length, totalRawFetched: fetched, totalJobsInDatabase: kept.length, bengaluruJobs: kept.filter(j => j.is_bengaluru).length, notified };
  } finally { scanning = false; }
}
