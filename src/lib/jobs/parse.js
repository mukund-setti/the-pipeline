// Job posting link parser, ported from the standalone JobTracker app.
// Server-only: it fetches other sites, which browsers cannot do directly, so
// it runs inside /api/parse-job. Plain JS (no types) to stay a faithful copy
// of the original; keep the two in sync when fixing an adapter.
//
// Turns a job posting URL into { title, company, location, salary, workMode, description, sections, skills, ... }.
// Strategy: use the public API of known applicant-tracking systems when the host is one
// (Greenhouse, Lever, Ashby, LinkedIn), then fall back to reading the page itself:
// schema.org JobPosting JSON-LD -> Open Graph tags -> the <title> tag -> the hostname.
// The posting body is kept in full (as light markdown) and split into prep-sheet sections.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12000;
const MAX_DESCRIPTION = 30000;

async function fetchText(url, accept = 'text/html,application/xhtml+xml,*/*;q=0.8') {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' },
    redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), finalUrl: res.url };
}
async function fetchJson(url) {
  const { text } = await fetchText(url, 'application/json');
  return JSON.parse(text);
}

// ---------- text utilities ----------
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '\u2014',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©' };
function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
function clean(s) { return decodeEntities(s).replace(/\s+/g, ' ').trim(); }
function inline(html) { return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); }

// Convert posting HTML into light markdown: "## " headings, "- " bullets, blank-line paragraphs.
function htmlToText(html) {
  let s = String(html ?? '');
  if (!/<[a-z][\s\S]*>/i.test(s)) return decodeEntities(s).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, t, x) => `\n\n## ${inline(x)}\n\n`);
  // A paragraph that is nothing but bold text is a heading in disguise (very common in Greenhouse/Lever content).
  s = s.replace(/<(p|div)\b[^>]*>\s*<(strong|b)\b[^>]*>([\s\S]*?)<\/\2>\s*:?\s*<\/\1>/gi, (m, t, u, x) => `\n\n## ${inline(x)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (m, x) => `\n- ${inline(x)}\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|ul|ol|tr|section|table|blockquote|article|header|footer)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Older helper kept for short snippets (meta descriptions, LinkedIn fragments).
function stripHtml(html) { return htmlToText(html).replace(/^## /gm, '').replace(/^- /gm, ''); }

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function metaContent(html, key) {
  const re = new RegExp(`<meta\\s+[^>]*?(?:property|name)\\s*=\\s*["']${escapeRe(key)}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return '';
  const c = tag[0].match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
  return c ? clean(c[1] ?? c[2]) : '';
}
function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? clean(m[1]) : '';
}
function h1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? inline(m[1]) : '';
}
function slugToName(slug) {
  return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}
function fmtMoney(n, cur) {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', INR: '₹' }[cur];
  const s = num.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return sym ? sym + s : cur ? `${s} ${cur}` : s;
}

// ---------- prep sheet: sections, skills, experience, level ----------
// Order matters: "preferred qualifications" must land in niceToHave, not requirements.
const SECTION_RULES = [
  ['niceToHave', /nice[ -]to[ -]have|preferred|bonus|plus\b|good to have|desirable|extra credit|even better|stand out|not required|may also|also have|we.?d love|if you also|would be great/i],
  ['responsibilities', /responsibilit|what you.?ll (do|be doing|work on|own)|what you will (do|be doing)|the role|your role|in this role|you will\b|you.?ll be\b|day[ -]to[ -]day|your impact|make an impact|trust you to|duties|what we need you to do|the opportunity|the position|the job|key accountabilit|description|what to expect|how you.?ll/i],
  ['requirements', /requirement|qualification|what we.?re looking for|what you.?ll bring|what you bring|about you|who you are|you have\b|must[ -]have|minimum|required|skills|experience|you should|ideal candidate|looking for|what you.?ll need|need to have|need to bring|what we need|bring to the table|sound like you|profile|your background|you are\b|good fit|fit if|what it takes|education/i],
  ['benefits', /benefit|perk|compensation|what we offer|why join|we offer|salary|pay range|total rewards|what.?s in it for you|why you.?ll love|our offer/i],
  ['about', /^about\b|who we are|our (team|mission|company|story)|the team|the company|overview|summary|company description|job description|meet the team|the mission|who are we/i],
];
const SECTION_LABELS = { responsibilities: 'Responsibilities', requirements: 'Requirements', niceToHave: 'Nice to have', benefits: 'Benefits', about: 'About' };
function classifyHeading(h) {
  for (const [key, re] of SECTION_RULES) if (re.test(h)) return key;
  return '';
}
function isHeadingLine(line) {
  if (line.startsWith('## ')) return true;
  if (line.startsWith('- ') || line.length > 70 || line.length < 3) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/:$/.test(line)) return true;
  return classifyHeading(line) !== '' && line.split(' ').length <= 8;
}
function extractSections(text) {
  const out = {};
  let current = '';
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeadingLine(line)) { current = classifyHeading(line.replace(/^## /, '').replace(/:$/, '')); continue; }
    // A pay line with no heading above it still belongs with benefits, as does everything after it.
    if (current !== 'benefits' && /^(salary|pay|compensation|base pay|the (base|salary|pay) range)\b/i.test(line)) current = 'benefits';
    if (!current) continue;
    const item = line.replace(/^- /, '').replace(/^[•·*–-]\s*/, '').trim();
    if (item.length < 3) continue;
    (out[current] ||= []);
    if (out[current].length < 40) out[current].push(item.slice(0, 500));
  }
  return out;
}

const SKILLS = ['Python', 'Java', 'JavaScript', 'TypeScript', 'Go', 'Golang', 'Rust', 'C++', 'C#', 'Ruby', 'Kotlin', 'Swift', 'Scala', 'PHP', 'SQL', 'MATLAB', 'Bash', 'Perl', 'Objective-C', 'Dart', 'Elixir', 'Haskell',
  'React', 'React Native', 'Angular', 'Vue', 'Svelte', 'Next.js', 'Node.js', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Rails', 'Ruby on Rails', '.NET', 'ASP.NET', 'Express', 'Laravel', 'Flutter', 'SwiftUI', 'Android', 'iOS', 'HTML', 'CSS', 'Tailwind', 'jQuery', 'Redux', 'GraphQL', 'REST', 'gRPC', 'WebSockets', 'OAuth',
  'Pandas', 'NumPy', 'Spark', 'PySpark', 'Hadoop', 'Kafka', 'Airflow', 'dbt', 'Snowflake', 'BigQuery', 'Redshift', 'Databricks', 'Tableau', 'Power BI', 'Looker', 'Excel', 'ETL', 'data warehouse', 'data pipelines', 'data modeling', 'A/B testing', 'statistics', 'experimentation',
  'PyTorch', 'TensorFlow', 'Keras', 'scikit-learn', 'XGBoost', 'LLM', 'LLMs', 'NLP', 'computer vision', 'machine learning', 'deep learning', 'reinforcement learning', 'RAG', 'Hugging Face', 'LangChain', 'OpenAI', 'transformers', 'MLOps', 'generative AI', 'CUDA',
  'AWS', 'GCP', 'Google Cloud', 'Azure', 'Kubernetes', 'Docker', 'Terraform', 'Ansible', 'CI/CD', 'Jenkins', 'GitHub Actions', 'Linux', 'Git', 'microservices', 'distributed systems', 'serverless', 'Lambda', 'S3', 'EC2', 'Redis', 'PostgreSQL', 'Postgres', 'MySQL', 'MongoDB', 'DynamoDB', 'Cassandra', 'Elasticsearch', 'SQLite', 'Oracle', 'NoSQL', 'Nginx', 'Datadog', 'Splunk', 'Prometheus', 'Grafana', 'observability', 'system design', 'security', 'networking', 'TCP/IP', 'DevOps', 'SRE',
  'Agile', 'Scrum', 'Jira', 'Confluence', 'Figma', 'Sketch', 'Salesforce', 'HubSpot', 'SAP', 'Workday', 'ServiceNow', 'Unity', 'Unreal', 'embedded', 'firmware', 'FPGA', 'Verilog', 'Simulink', 'AutoCAD', 'SolidWorks', 'Selenium', 'Cypress', 'Playwright', 'Jest', 'unit testing', 'TDD', 'product management', 'roadmap', 'stakeholder management', 'project management', 'PMP', 'Six Sigma', 'Lean', 'SEO', 'Google Analytics', 'copywriting', 'CRM', 'B2B', 'SaaS', 'fintech', 'healthcare', 'HIPAA', 'GDPR', 'SOC 2', 'blockchain', 'Solidity'];
const SKILL_RES = SKILLS.map(s => [s, new RegExp(`(?<![\\w.+#/-])${escapeRe(s)}(?![\\w+#-])`, /^[A-Z][a-z]|\b[A-Z]{2,}\b|[.+#/]/.test(s) && s.length <= 4 ? '' : 'i')]);
function extractSkills(text) {
  const found = [];
  for (const [name, re] of SKILL_RES) {
    const m = re.exec(text);
    if (m) found.push([m.index, name]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const seen = new Set(); const out = [];
  for (const [, name] of found) {
    const key = name.toLowerCase().replace(/^golang$/, 'go').replace(/^postgres$/, 'postgresql').replace(/^google cloud$/, 'gcp').replace(/^llms$/, 'llm').replace(/^ruby on rails$/, 'rails');
    if (seen.has(key)) continue;
    seen.add(key); out.push(name);
    if (out.length >= 30) break;
  }
  return out;
}
function extractExperience(text) {
  const m = text.match(/(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?)?\s*(?:\+\s*)?years?(?:'|’)?\s*(?:of\s+)?(?:\w+\s+){0,3}?experience/i);
  if (!m) return '';
  if (m[2]) return `${m[1]} to ${m[2]} years`;
  return /\+|plus/i.test(m[0].slice(0, m[0].indexOf('year'))) ? `${m[1]}+ years` : `${m[1]} years`;
}
function extractLevel(title) {
  const t = String(title || '');
  if (/\bintern(ship)?\b/i.test(t)) return 'Intern';
  if (/\b(new grad|new college grad|college grad|entry[ -]level|graduate|junior|jr\.?|associate|early career|university)\b/i.test(t)) return 'Junior';
  if (/\b(principal|distinguished|fellow)\b/i.test(t)) return 'Principal';
  if (/\bstaff\b/i.test(t)) return 'Staff';
  if (/\b(director|vp|vice president|head of|chief)\b/i.test(t)) return 'Director+';
  if (/\b(manager|mgr)\b/i.test(t)) return 'Manager';
  if (/\b(lead|tech lead)\b/i.test(t)) return 'Lead';
  if (/\b(senior|sr\.?)\b/i.test(t)) return 'Senior';
  if (/\b(mid[ -]level|ii|2)\b/i.test(t)) return 'Mid';
  return '';
}

// ---------- schema.org JobPosting ----------
function jsonLdJobPostings(html) {
  const out = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const t = node['@type']; const types = Array.isArray(t) ? t : [t];
    if (types.includes('JobPosting')) out.push(node);
    if (node['@graph']) walk(node['@graph']);
    if (node.mainEntity) walk(node.mainEntity);
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* malformed block, skip */ }
  }
  return out;
}
function fromJobPosting(jp) {
  const org = jp.hiringOrganization;
  const company = typeof org === 'string' ? org : org?.name;
  const locs = Array.isArray(jp.jobLocation) ? jp.jobLocation : jp.jobLocation ? [jp.jobLocation] : [];
  const location = locs.map(l => {
    if (typeof l === 'string') return l;
    const a = l?.address; if (!a) return l?.name || '';
    if (typeof a === 'string') return a;
    return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
  }).filter(Boolean).slice(0, 3).join(' / ');
  let salary = '';
  const bs = jp.baseSalary;
  if (bs) {
    const v = bs.value && typeof bs.value === 'object' ? bs.value : bs;
    const cur = bs.currency || v.currency || '';
    if (v.minValue != null || v.maxValue != null) salary = [fmtMoney(v.minValue, cur), fmtMoney(v.maxValue, cur)].filter(Boolean).join(' – ');
    else if (v.value != null) salary = fmtMoney(v.value, cur);
    if (salary && v.unitText) salary += ' / ' + String(v.unitText).toLowerCase();
  }
  const remote = String(jp.jobLocationType || '').toUpperCase() === 'TELECOMMUTE';
  const et = Array.isArray(jp.employmentType) ? jp.employmentType.join(', ') : jp.employmentType;
  return {
    title: clean(jp.title), company: clean(company), location: clean(location) || (remote ? 'Remote' : ''),
    salary, workMode: remote ? 'Remote' : '', postedAt: jp.datePosted ? String(jp.datePosted).slice(0, 10) : '',
    employmentType: clean(et).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
    descriptionHtml: jp.description || '', description: htmlToText(jp.description),
  };
}

// ---------- title heuristics ----------
const GENERIC = /^(careers?|jobs?|job (details?|description|posting|opening|application|search)|linkedin|indeed|glassdoor|greenhouse|lever|workday|myworkdayjobs|apply( now)?|home|open positions?|current openings|job board|welcome|search jobs)$/i;
const ROLE = /\b(engineer(ing)?|developer|manager|designer|analyst|scientist|intern(ship)?|director|lead|specialist|architect|consultant|associate|coordinator|administrator|recruiter|accountant|nurse|technician|writer|marketer|sales|product|research(er)?|head of|vp|president|officer|assistant|representative|principal|staff|senior|junior|sde|swe|pm|qa|devops|sre)\b/i;
function splitTitle(raw, site) {
  const t = clean(raw).replace(/\s*[|\-–\u2014]\s*(careers?|jobs?|linkedin|indeed|glassdoor|job board)\s*$/i, '');
  const out = { title: '', company: '', location: '' };
  if (!t) return out;
  let m;
  if ((m = t.match(/^job application for (.+?) at (.+)$/i))) return { title: m[1], company: m[2], location: '' };
  if ((m = t.match(/^(.+?) hiring (.+?) in (.+?)$/i))) return { title: m[2], company: m[1], location: m[3] };
  if ((m = t.match(/^(.+?) hiring (.+?)$/i))) return { title: m[2], company: m[1], location: '' };
  if ((m = t.match(/^(.+?) (?:is|are) hiring:?\s*(.+)$/i))) return { title: m[2], company: m[1], location: '' };
  const parts = t.split(/\s+[|\-–\u2014:·»]\s+|\s+at\s+|\s+@\s+/).map(clean).filter(p => p && !GENERIC.test(p));
  if (!parts.length) return out;
  if (parts.length === 1) return { ...out, title: parts[0] };
  const siteIdx = site ? parts.findIndex(p => p.toLowerCase() === site.toLowerCase()) : -1;
  if (siteIdx >= 0) {
    const rest = parts.filter((_, i) => i !== siteIdx);
    return { title: rest[0], company: parts[siteIdx], location: rest[1] || '' };
  }
  const ti = parts.findIndex(p => ROLE.test(p));
  if (ti > 0) return { title: parts[ti], company: parts[0], location: parts.slice(ti + 1)[0] || '' };
  return { title: parts[0], company: parts[1], location: parts[2] || '' };
}
function isGenericSite(site) { return !site || GENERIC.test(site); }
function guessCompanyFromHost(u) {
  const labels = u.hostname.toLowerCase().replace(/^www\./, '').split('.');
  const skip = /^(www|careers?|jobs?|boards?|apply|job-boards|talent|recruiting|hire|work|join|people|wd\d+|myworkdayjobs|myworkdaysite|greenhouse|lever|ashbyhq|linkedin|indeed|glassdoor|workable|bamboohr|smartrecruiters|icims|jobvite|avature|eightfold|phenom|successfactors|taleo|oraclecloud|ultipro|paylocity|rippling|wellfound|ziprecruiter|com|io|co|org|net|ai|dev|app)$/;
  const first = labels.find(l => !skip.test(l));
  return first ? slugToName(first) : '';
}
function tidyCompany(c) {
  const parts = clean(c).split(/\s+[|\u2013\u2014-]\s+/).filter(Boolean);
  if (parts.length > 1) c = parts.find(x => !/\b(careers?|jobs|hiring|job board)\b/i.test(x)) || parts[0];
  return clean(c).replace(/^\d{2,}\s*[-–:]?\s*/, '').replace(/\s*(careers?|jobs|hiring|is hiring|job board)$/i, '').replace(/^(careers? at|jobs at|work at)\s+/i, '').trim();
}
// "New York", "Austin, TX", "Remote": things a title splitter might mistake for a company.
const LOCATIONISH = /^(remote|hybrid|on-?site|multiple locations|worldwide|[A-Za-z .'’-]+,\s*[A-Za-z .]+|new york( city)?|nyc|san francisco|bay area|los angeles|seattle|boston|chicago|austin|denver|atlanta|dallas|houston|washington,? d\.?c\.?|london|dublin|berlin|paris|amsterdam|toronto|vancouver|bangalore|bengaluru|hyderabad|mumbai|singapore|sydney|tokyo|united states|usa|u\.s\.|uk|india|canada|germany|europe|emea|apac)$/i;
function looksLikeLocation(s) { return LOCATIONISH.test(String(s || '').trim()); }
function findSalary(text) {
  if (!text) return '';
  const re = /(?:USD|US\$|\$|€|£)\s?\d{2,3}(?:[,.]\d{3})*(?:\.\d+)?\s?[kK]?(?:\s?(?:-|–|\u2014|to)\s?(?:USD|US\$|\$|€|£)?\s?\d{2,3}(?:[,.]\d{3})*(?:\.\d+)?\s?[kK]?)?/;
  const m = text.match(re);
  if (m) return clean(m[0]);
  // "Salary Range = 158,000 - 158,000 USD Annual": currency after the numbers.
  const m2 = text.match(/(?:salary|pay|compensation)[^\n]{0,40}?(\d{2,3},\d{3}(?:\s*(?:-|–|to)\s*\d{2,3},\d{3})?\s*(?:USD|EUR|GBP|CAD|AUD|INR)?(?:\s*(?:annual|per year|\/ ?year|yearly))?)/i);
  return m2 ? clean(m2[1]) : '';
}
// "Location\n\nNew York\n\nBusiness Area\n\nEngineering": label/value pairs that many career sites print above the body.
const LABELS = [
  ['location', /^(location|locations|office|city|work location|job location)$/i],
  ['team', /^(business area|department|team|function|job function|category|job category|division|group|practice area)$/i],
  ['employmentType', /^(job type|employment type|type|schedule|time type|contract type|position type|work type)$/i],
  ['postedAt', /^(posted|posted on|date posted|posting date|published)$/i],
  ['jobRef', /^(ref ?#?|reference|reference number|job id|job ref|req(?:uisition)? ?(?:id|#|number)?|posting id|job number|job code)$/i],
];
function extractLabeled(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 60);
  const out = {};
  for (let i = 0; i + 1 < lines.length; i++) {
    const label = lines[i].replace(/:$/, '');
    if (label.length > 24) continue;
    for (const [key, re] of LABELS) {
      if (out[key] || !re.test(label)) continue;
      const value = lines[i + 1].replace(/^[-•]\s*/, '');
      if (value.length > 80 || value.startsWith('## ') || LABELS.some(([, r]) => r.test(value.replace(/:$/, '')))) continue;
      out[key] = value;
    }
  }
  if (out.postedAt) { const d = new Date(out.postedAt); out.postedAt = Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
  return out;
}
const BOILERPLATE = /^(-\s*)?(apply( now| here)?|back to (job )?search|back to jobs?|save( this)? job|share( this)?( job)?|print|refer a friend|apply for this job|job details|job description)$/i;
function dropBoilerplate(text) {
  return String(text || '').split('\n').filter(l => !BOILERPLATE.test(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function findWorkMode(text) {
  if (/\bhybrid\b/i.test(text)) return 'Hybrid';
  if (/\bremote\b/i.test(text)) return 'Remote';
  if (/\b(on-?site|in-?office|in person)\b/i.test(text)) return 'On-site';
  return '';
}

// ---------- ATS adapters (public JSON APIs, cleaner than scraping) ----------
async function greenhouse(u) {
  const id = (u.pathname.match(/\/jobs\/(\d+)/) || [])[1] || u.searchParams.get('token') || u.searchParams.get('gh_jid');
  const board = u.searchParams.get('for') || u.pathname.split('/').filter(Boolean)[0];
  if (!id || !board || board === 'embed') return null;
  return greenhouseJob(board, id);
}
// Company-domain Greenhouse pages (careers.withwaymo.com/jobs?gh_jid=123) render
// the posting with scripts. Greenhouse's embed link redirects to ?for=<board>,
// which names the board, and then the public API has the whole posting.
async function greenhouseCustom(u) {
  const id = u.searchParams.get('gh_jid');
  if (!/^\d+$/.test(id || '')) return null;
  const { finalUrl } = await fetchText(`https://boards.greenhouse.io/embed/job_app?token=${id}`);
  const board = new URL(finalUrl).searchParams.get('for');
  return board ? greenhouseJob(board, id) : null;
}
async function greenhouseJob(board, id) {
  const j = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`);
  const html = decodeEntities(j.content || '');
  return { title: clean(j.title), company: clean(j.company_name) || slugToName(board), location: clean(j.location?.name),
    team: clean((j.departments || []).map(d => d.name).filter(Boolean).join(' / ')),
    postedAt: (j.updated_at || '').slice(0, 10), descriptionHtml: html, description: htmlToText(html) };
}
async function lever(u) {
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const j = await fetchJson(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`);
  const c = j.categories || {};
  const sr = j.salaryRange; let salary = '';
  if (sr && (sr.min || sr.max)) salary = [fmtMoney(sr.min, sr.currency), fmtMoney(sr.max, sr.currency)].filter(Boolean).join(' – ') + (sr.interval ? ` / ${String(sr.interval).replace(/-/g, ' ')}` : '');
  const wp = String(j.workplaceType || '');
  // Lever splits the posting into an intro, named lists, and a closing block. Stitch them back into one document.
  const html = [j.description || '', ...(j.lists || []).map(l => `<h3>${l.text || ''}</h3><ul>${l.content || ''}</ul>`), j.additional || ''].join('\n');
  return { title: clean(j.text), company: slugToName(m[1]), location: clean(c.location), salary,
    team: clean([c.team, c.department].filter(Boolean).join(' / ')),
    workMode: /remote/i.test(wp) ? 'Remote' : /hybrid/i.test(wp) ? 'Hybrid' : /on-?site/i.test(wp) ? 'On-site' : '',
    employmentType: clean(c.commitment), postedAt: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : '',
    descriptionHtml: html, description: htmlToText(html) };
}
async function ashby(u) {
  const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const j = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true`);
  const job = (j.jobs || []).find(x => x.id === m[2]);
  if (!job) return null;
  const html = job.descriptionHtml || job.descriptionPlain || '';
  return { title: clean(job.title), company: slugToName(m[1]), location: clean(job.location), workMode: job.isRemote ? 'Remote' : '',
    team: clean([job.team, job.department].filter(Boolean).join(' / ')),
    employmentType: clean(job.employmentType), postedAt: (job.publishedAt || '').slice(0, 10),
    salary: clean(job.compensation?.compensationTierSummary || ''), descriptionHtml: html, description: htmlToText(html) };
}
async function linkedin(u) {
  const id = (u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d+)/) || [])[1] || u.searchParams.get('currentJobId');
  if (!id) return null;
  const { text: html } = await fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
  const pick = re => { const m = html.match(re); return m ? inline(m[1]) : ''; };
  const title = pick(/<h2[^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
  if (!title) return null;
  const body = (html.match(/<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<button)/i) || [])[1] || '';
  const criteria = {};
  for (const m of html.matchAll(/<h3[^>]*description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)) criteria[inline(m[1]).toLowerCase()] = inline(m[2]);
  return {
    title,
    company: pick(/<a[^>]*class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i),
    location: pick(/<span[^>]*class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i),
    employmentType: criteria['employment type'] || '', team: criteria['job function'] || '',
    level: criteria['seniority level'] || '',
    descriptionHtml: body, description: htmlToText(body),
  };
}
async function workday(u) {
  // https://{tenant}.wd5.myworkdayjobs.com/{locale?}/{site}/job/{location}/{slug}_{reqId}
  //   -> https://{tenant}.wd5.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job/{location}/{slug}_{reqId}
  const tenant = u.hostname.split('.')[0];
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length && /^[a-z]{2}-[A-Za-z]{2}$/.test(parts[0])) parts.shift();
  const jobIdx = parts.findIndex(p => p === 'job' || p === 'details');
  if (jobIdx < 1) return null;
  const site = parts.slice(0, jobIdx).join('/');
  const j = await fetchJson(`https://${u.hostname}/wday/cxs/${tenant}/${site}/job/${parts.slice(jobIdx + 1).join('/')}`);
  const p = j.jobPostingInfo || {};
  if (!p.title) return null;
  const html = p.jobDescription || '';
  return { title: clean(p.title), company: clean(j.hiringOrganization?.name), location: clean(p.location).replace(/,(?=\S)/g, ', '),
    employmentType: clean(p.timeType), postedAt: String(p.startDate || '').slice(0, 10),
    descriptionHtml: html, description: htmlToText(html) };
}
// Simplify (simplify.jobs/p/<id> or /jobs/click/<id>). The job page embeds the
// whole posting as JSON, and /jobs/click/<id> redirects to the employer's real
// application page, which is returned as applyUrl so the tracker stores that.
function stripTracking(raw) {
  try {
    const x = new URL(raw);
    for (const k of [...x.searchParams.keys()]) {
      if (/^utm_/i.test(k) || (/^(ref|gh_src|source)$/i.test(k) && /simplify/i.test(x.searchParams.get(k) || ''))) x.searchParams.delete(k);
    }
    return x.href.replace(/\?$/, '');
  } catch { return raw; }
}
async function simplify(u) {
  const id = (u.pathname.match(/^\/(?:p|jobs\/click)\/([0-9a-f-]{36})/i) || [])[1];
  if (!id) return null;
  const { text } = await fetchText(`https://simplify.jobs/p/${id}`);
  const m = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const jp = m ? JSON.parse(m[1])?.props?.pageProps?.jobPosting : null;
  if (!jp) return null;
  let applyUrl = '';
  try {
    const r = await fetch(`https://simplify.jobs/jobs/click/${id}`, {
      redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const loc = r.headers.get('location') || '';
    if (/^https?:\/\//i.test(loc) && !/(^|\.)simplify\.jobs\//i.test(new URL(loc).hostname + '/')) applyUrl = stripTracking(loc);
  } catch { /* keep the Simplify link */ }
  const cur = jp.currency_type || 'USD';
  const lo = Number(jp.min_salary) || 0, hi = Number(jp.max_salary) || 0;
  let salary = [lo && fmtMoney(lo, cur), hi && hi !== lo && fmtMoney(hi, cur)].filter(Boolean).join(' \u2013 ');
  if (salary) salary += (hi || lo) < 1000 ? ' / hour' : ' / year';
  const list = v => (Array.isArray(v) ? v.map(x => clean(typeof x === 'string' ? x : x?.value || x?.name || '')).filter(Boolean) : []);
  const presetSections = {};
  if (list(jp.responsibilities).length) presetSections.responsibilities = list(jp.responsibilities);
  if (list(jp.requirements).length) presetSections.requirements = list(jp.requirements);
  if (list(jp.desirable).length) presetSections.niceToHave = list(jp.desirable);
  const html = jp.description || '';
  return {
    title: clean(jp.title || jp.job?.title), company: clean(jp.job?.company?.name),
    location: list(jp.locations).slice(0, 3).join(' / '), salary,
    postedAt: String(jp.start_date || '').slice(0, 10),
    descriptionHtml: html, description: htmlToText(html),
    presetSections, presetSkills: list(jp.skills), applyUrl,
  };
}

async function smartrecruiters(u) {
  // jobs.smartrecruiters.com/<Company>/<postingId>[-slug]
  const m = u.pathname.match(/^\/([^/]+)\/(\d{6,})/);
  if (!m) return null;
  const j = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${m[1]}/postings/${m[2]}`);
  if (!j?.name) return null;
  const sec = j.jobAd?.sections || {};
  const company = clean(j.company?.name) || slugToName(m[1]);
  const html = [
    sec.jobDescription?.text && `<h3>Job description</h3>${sec.jobDescription.text}`,
    sec.qualifications?.text && `<h3>Qualifications</h3>${sec.qualifications.text}`,
    sec.additionalInformation?.text && `<h3>Additional information</h3>${sec.additionalInformation.text}`,
    sec.companyDescription?.text && `<h3>About ${company}</h3>${sec.companyDescription.text}`,
  ].filter(Boolean).join('\n');
  const loc = j.location || {};
  return {
    title: clean(j.name), company,
    location: clean(loc.fullLocation || [loc.city, loc.region].filter(Boolean).join(', ')).replace(/\s*,\s*/g, ', '),
    workMode: loc.remote ? 'Remote' : loc.hybrid ? 'Hybrid' : '',
    employmentType: clean(j.typeOfEmployment?.label), level: clean(j.experienceLevel?.label),
    team: clean(j.department?.label || j.function?.label), postedAt: String(j.releasedDate || '').slice(0, 10),
    descriptionHtml: html, description: htmlToText(html),
  };
}
async function oracle(u) {
  // <tenant>.fa.<dc>.oraclecloud.com/hcmUI/CandidateExperience/<lang>/sites/<site>/job/<id>
  const m = u.pathname.match(/\/sites\/([^/]+)\/job\/(\d+)/);
  if (!m) return null;
  const api = `${u.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${m[2]}%22,siteNumber=${m[1]}`;
  const r = (await fetchJson(api))?.items?.[0];
  if (!r?.Title) return null;
  const html = [
    r.ExternalDescriptionStr && `<h3>Job description</h3>${r.ExternalDescriptionStr}`,
    r.ExternalResponsibilitiesStr && `<h3>Responsibilities</h3>${r.ExternalResponsibilitiesStr}`,
    r.ExternalQualificationsStr && `<h3>Qualifications</h3>${r.ExternalQualificationsStr}`,
    r.CorporateDescriptionStr && `<h3>About the company</h3>${r.CorporateDescriptionStr}`,
  ].filter(Boolean).join('\n');
  const wp = String(r.WorkplaceType || '');
  return {
    title: clean(r.Title), company: clean(r.LegalEmployer || r.BusinessUnit || ''), location: clean(r.PrimaryLocation),
    workMode: /remote/i.test(wp) ? 'Remote' : /hybrid/i.test(wp) ? 'Hybrid' : /on-?site/i.test(wp) ? 'On-site' : '',
    employmentType: clean(r.JobSchedule || r.JobType), team: clean(r.Department || r.JobFunction),
    postedAt: String(r.ExternalPostedStartDate || '').slice(0, 10), jobRef: clean(r.Id),
    descriptionHtml: html, description: htmlToText(html),
  };
}
async function avature(u) {
  // The normal JobDetail page renders the posting with scripts; JobDetailPartner is the server-rendered copy.
  const id = (u.pathname.match(/\/JobDetail\/[^/]*\/(\d+)/i) || [])[1] || u.searchParams.get('jobId');
  const portal = u.pathname.split('/').filter(Boolean)[0];
  if (!id || !portal) return null;
  const { text } = await fetchText(`${u.origin}/${portal}/JobDetailPartner?jobId=${id}`);
  const r = fromHtml(text);
  return r.description && r.description.length > 200 ? r : null;
}
const ADAPTERS = [
  { name: 'Simplify', test: u => /(^|\.)simplify\.jobs$/i.test(u.hostname), run: simplify },
  { name: 'Workday', test: u => /\.myworkday(jobs|site)\.com$/i.test(u.hostname), run: workday },
  { name: 'Avature', test: u => /\.avature\.net$/i.test(u.hostname), run: avature },
  { name: 'Greenhouse', test: u => /(^|\.)greenhouse\.io$/i.test(u.hostname), run: greenhouse },
  { name: 'Greenhouse', test: u => !/(^|\.)greenhouse\.io$/i.test(u.hostname) && u.searchParams.has('gh_jid'), run: greenhouseCustom },
  { name: 'SmartRecruiters', test: u => /^jobs\.smartrecruiters\.com$/i.test(u.hostname), run: smartrecruiters },
  { name: 'Oracle', test: u => /\.oraclecloud\.com$/i.test(u.hostname), run: oracle },
  { name: 'Lever', test: u => /(^|\.)lever\.co$/i.test(u.hostname), run: lever },
  { name: 'Ashby', test: u => /(^|\.)ashbyhq\.com$/i.test(u.hostname), run: ashby },
  { name: 'LinkedIn', test: u => /(^|\.)linkedin\.com$/i.test(u.hostname), run: linkedin },
];

// ---------- generic page parsing ----------
function mainContent(html) {
  let s = html.replace(/<(nav|header|footer|aside|script|style|noscript|svg|form)\b[\s\S]*?<\/\1>/gi, '');
  const pick = s.match(/<main\b[\s\S]*?<\/main>/i) || s.match(/<article\b[\s\S]*?<\/article>/i) || s.match(/<body\b[\s\S]*?<\/body>/i);
  return pick ? pick[0] : s;
}
function fromHtml(html) {
  const jps = jsonLdJobPostings(html);
  const r = jps.length ? fromJobPosting(jps[0]) : {};
  const site = metaContent(html, 'og:site_name');
  const pageTitle = metaContent(html, 'og:title') || titleTag(html) || h1(html);
  const guess = splitTitle(pageTitle, site);
  if (!isGenericSite(site) && guess.company && guess.company.toLowerCase() !== site.toLowerCase()) {
    // The site name is the employer; whatever the title split produced is probably a location or noise.
    if (looksLikeLocation(guess.company) && !guess.location) guess.location = guess.company;
    guess.company = site;
  } else if (looksLikeLocation(guess.company)) {
    if (!guess.location) guess.location = guess.company;
    guess.company = '';
  }
  fill(r, { title: guess.title || h1(html), company: guess.company || (isGenericSite(site) ? '' : site), location: guess.location });
  if (!r.description || r.description.length < 200) {
    const body = htmlToText(mainContent(html));
    if (body.length > (r.description || '').length) { r.description = body; r.descriptionHtml = ''; }
  }
  if (!r.description) r.description = metaContent(html, 'og:description') || metaContent(html, 'description');
  return r;
}
function fill(target, extra) {
  for (const [k, v] of Object.entries(extra || {})) if (!target[k] && v) target[k] = v;
  return target;
}

async function parseJobUrl(rawUrl) {
  const u = new URL(rawUrl);
  const result = { url: u.href, host: u.hostname.replace(/^www\./, ''), source: 'page', title: '', company: '', location: '',
    salary: '', workMode: '', employmentType: '', postedAt: '', team: '', level: '', description: '', warnings: [] };
  for (const a of ADAPTERS) {
    if (!a.test(u)) continue;
    try {
      const r = await a.run(u);
      if (r) { fill(result, r); result.source = a.name; }
    } catch (e) { result.warnings.push(`${a.name}: ${e.message}`); }
  }
  if (!result.title || !result.company || !result.description) {
    try { fill(result, fromHtml((await fetchText(u.href)).text)); }
    catch (e) { result.warnings.push(`Page: ${e.message}`); }
  }
  delete result.descriptionHtml;
  result.description = dropBoilerplate(String(result.description || '')).slice(0, MAX_DESCRIPTION);
  const labeled = extractLabeled(result.description);
  for (const k of ['location', 'team', 'employmentType', 'postedAt']) if (!result[k] && labeled[k]) result[k] = labeled[k];
  if (labeled.jobRef) result.jobRef = labeled.jobRef;
  if (!result.salary) result.salary = findSalary(result.description);
  // "$60 - $60" is one number.
  result.salary = String(result.salary || '').replace(/^(.+?)\s*(?:-|–|—|to)\s*\1$/, '$1');
  if (!result.workMode) result.workMode = findWorkMode(`${result.location} ${result.title} ${result.description.slice(0, 1200)}`);
  if (!result.company) result.company = guessCompanyFromHost(u);
  result.company = tidyCompany(result.company);
  result.title = clean(result.title).slice(0, 200);
  const preset = result.presetSections && Object.keys(result.presetSections).length ? result.presetSections : null;
  result.sections = preset ? { ...extractSections(result.description), ...preset } : extractSections(result.description);
  const extracted = extractSkills(`${result.title}\n${result.description}`);
  const seen = new Set();
  result.skills = [...(result.presetSkills || []), ...extracted]
    .filter(x => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 30);
  delete result.presetSections;
  delete result.presetSkills;
  if (!result.applyUrl) delete result.applyUrl;
  result.experience = extractExperience(result.description);
  if (!result.level) result.level = extractLevel(result.title);
  return result;
}

export { parseJobUrl, splitTitle, findSalary, findWorkMode, fromJobPosting, jsonLdJobPostings, htmlToText, extractSections, extractSkills, extractExperience, extractLevel, extractLabeled, looksLikeLocation, SECTION_LABELS };