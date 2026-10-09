// Runs on GitHub's computers every 15 minutes. It checks company job boards and sends an alert for NEW matching jobs.
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync('alerts.config.json', 'utf8'));
const SEEN_FILE = 'alerts/seen.json';
const INDIA = /india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|gurgaon|gurugram|noida|kolkata|ahmedabad/i;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, word) => new RegExp('(?<![a-z0-9])' + esc(word.toLowerCase()) + '(?![a-z0-9])', 'i').test(text);
// Title words match inside longer words (recruit finds recruiter and recruiting). Very short words like hr must stand alone.
const inTitle = (t, w) => (w.length <= 3 ? has(t, w) : t.includes(w.toLowerCase()));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const ascii = s => String(s).replace(/[^\x20-\x7e]/g, '');

async function notify(title, body, url) {
  const topic = process.env.NTFY_TOPIC;
  if (topic) {
    const headers = { Title: ascii(title), Tags: 'briefcase' };
    if (url) headers.Click = url;
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', headers, body }).catch(() => {});
  }
  if (cfg.githubIssues !== false && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'job-alerts-bot' },
      body: JSON.stringify({ title, body: `${body}${url ? `\n\n${url}` : ''}` }),
    }).catch(() => {});
  }
}

if (process.env.TEST === 'true') {
  await notify('Test alert', 'Your job alerts are working. You will get a message like this when a new matching job appears.', '');
  console.log('Test alert sent.');
  process.exit(0);
}

const getJson = async url => { try { const r = await fetch(url, { headers: { 'User-Agent': 'job-alerts-bot' } }); return r.ok ? await r.json() : null; } catch { return null; } };
const jobs = [];
const add = (company, title, location, url, remote = false, keepQuery = false, trusted = true) => {
  if (title && url) jobs.push({ company, title: String(title).trim(), location: location || '', url: keepQuery ? String(url) : String(url).split('?')[0], remote, trusted });
};

await Promise.all([
  ...cfg.greenhouse.map(async s => { const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs`); (d?.jobs || []).forEach(j => add(cap(s), j.title, j.location?.name, j.absolute_url, /remote/i.test(j.location?.name || ''))); }),
  ...cfg.lever.map(async s => { const d = await getJson(`https://api.lever.co/v0/postings/${s}?mode=json`); (Array.isArray(d) ? d : []).forEach(j => add(cap(s), j.text, j.categories?.location, j.hostedUrl, /remote/i.test(j.workplaceType || ''))); }),
  ...cfg.ashby.map(async s => { const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${s}`); (d?.jobs || []).filter(j => j.isListed !== false).forEach(j => add(cap(s), j.title, j.location, j.jobUrl, !!j.isRemote)); }),
]);

// Optional: Adzuna, only if you saved ADZUNA_ID and ADZUNA_KEY as repository secrets. Only well-regarded employers trigger alerts.
if (process.env.ADZUNA_ID && process.env.ADZUNA_KEY) {
  const qs = [['talent acquisition', 'Bengaluru'], ['recruitment manager', 'Bengaluru'], ['talent partner', 'Bengaluru'], ['talent acquisition', '']];
  await Promise.all(qs.map(async ([w, l]) => {
    const d = await getJson(`https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${encodeURIComponent(process.env.ADZUNA_ID)}&app_key=${encodeURIComponent(process.env.ADZUNA_KEY)}&results_per_page=50&sort_by=date&what=${encodeURIComponent(w)}${l ? `&where=${encodeURIComponent(l)}` : ''}`);
    (d?.results || []).forEach(j => {
      const company = j.company?.display_name || 'Unknown company';
      add(company, j.title, `${j.location?.display_name || 'India'}, India`, j.redirect_url, false, true, (cfg.employers || []).some(e => has(company, e)));
    });
  }));
}

const keyOf = j => `${j.company}|${j.title}|${j.location}`.toLowerCase();
const wanted = [];
const dup = new Set();
for (const j of jobs) {
  const t = j.title.toLowerCase();
  if (!j.trusted || !cfg.titleWords.some(w => inTitle(t, w)) || cfg.excludeWords.some(w => has(t, w))) continue;
  if (!(INDIA.test(j.location) || (j.remote && cfg.includeRemoteAnywhere))) continue;
  if (dup.has(keyOf(j))) continue;
  dup.add(keyOf(j)); wanted.push(j);
}

let seen = []; let first = true;
try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); first = false; } catch {}
const seenSet = new Set(seen);
const fresh = wanted.filter(j => !seenSet.has(keyOf(j)));
console.log(`Checked ${jobs.length} openings. ${wanted.length} match your search. ${fresh.length} are new.`);

if (first) {
  await notify('Job alerts are on', `Now watching ${wanted.length} matching jobs. You will get a message when a new one appears.`, '');
} else {
  for (const j of fresh.slice(0, 20)) await notify(`New: ${j.title} at ${j.company}`, `${j.title}\n${j.company}\n${j.location}`, j.url);
}

fs.mkdirSync('alerts', { recursive: true });
fs.writeFileSync(SEEN_FILE, JSON.stringify([...new Set([...seenSet, ...wanted.map(keyOf)])].slice(-5000)));
