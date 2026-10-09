/**
 * Resume -> opportunity recommender behind the "For you" view on
 * Opportunities. Pure: no DOM, no network, no storage. It runs in the browser
 * on resume text that never leaves the member's device, and under node --test
 * (see recommend.test.ts).
 *
 * Model: content-based TF-IDF in a shared concept space, plus two priors.
 *
 *  1. Concepts, not words. Opportunity rows are short (a title and a few
 *     tags), so raw word overlap with a full resume is mostly "software" and
 *     "intern". Both sides are mapped through LEXICON into canonical skill
 *     concepts first, which is what lets "PyTorch" on a resume meet an
 *     `ai-ml` tag on a job.
 *  2. TF-IDF. Resume concepts get sublinear term frequency; every concept is
 *     weighted by inverse document frequency over the live opportunity set, so
 *     a concept nearly every row carries (swe) counts for little and a rare one
 *     (embedded) counts for a lot. Similarity is cosine.
 *  3. Class-year fit. Expected graduation year is read off the resume; roles
 *     tagged for underclassmen and new-grad roles are nudged up or down to
 *     match, because a perfect skills match you are not eligible for is not a
 *     recommendation.
 *  4. Implicit feedback. Roles similar to ones the member already saved or
 *     applied to get a small boost (item-item cosine in the same space).
 *
 * The score is a ranking signal, not a probability, so the UI shows reasons
 * ("AI / ML, Data") and never a match percentage.
 */
import type { JobActionMap, Opportunity } from './types';

/* ------------------------------- lexicon -------------------------------- */

type ConceptDef = {
  label: string;
  /** Opportunity tags that assert this concept directly. */
  tags: string[];
  /** Surface forms, matched case-insensitively on word boundaries. */
  terms: string[];
};

/**
 * Canonical skill concepts. Terms are regex source fragments (escaped where it
 * matters: c\+\+, next\.js). Keep entries specific: a term that fires on every
 * resume ("programming", "python") adds noise, not signal, and IDF can only
 * discount concepts that also appear on the job side.
 */
export const LEXICON: Record<string, ConceptDef> = {
  swe: {
    label: 'Software engineering',
    tags: ['swe'],
    terms: ['software engineer(?:ing)?', 'software developer', 'swe', 'full[- ]?stack'],
  },
  frontend: {
    label: 'Frontend',
    tags: ['frontend', 'web'],
    terms: ['front[- ]?end', 'react', 'next\\.js', 'vue', 'angular', 'typescript', 'javascript', 'html', 'css', 'tailwind'],
  },
  backend: {
    label: 'Backend',
    tags: ['backend'],
    terms: ['back[- ]?end', 'node\\.?js', 'express', 'django', 'flask', 'fastapi', 'spring boot', 'graphql', 'rest(?:ful)? apis?', 'microservices', 'postgres(?:ql)?', 'supabase'],
  },
  'ai-ml': {
    label: 'AI / ML',
    tags: ['ai-ml', 'ml', 'ai'],
    terms: ['machine learning', 'deep learning', 'pytorch', 'tensorflow', 'scikit-learn', 'sklearn', 'nlp', 'natural language processing', 'computer vision', 'llms?', 'neural networks?', 'reinforcement learning', 'transformers?', 'artificial intelligence', 'hugging ?face', 'yolo'],
  },
  data: {
    label: 'Data',
    tags: ['data', 'analytics'],
    terms: ['data science', 'data scientist', 'data analy(?:st|sis|tics)', 'data engineer(?:ing)?', 'pandas', 'numpy', 'sql', 'tableau', 'power bi', 'statistics', 'spark', 'etl', 'dbt'],
  },
  embedded: {
    label: 'Embedded',
    tags: ['embedded', 'firmware'],
    terms: ['embedded', 'firmware', 'microcontrollers?', 'arduino', 'rtos', 'raspberry pi', 'stm32'],
  },
  hardware: {
    label: 'Hardware',
    tags: ['hardware'],
    terms: ['hardware', 'fpga', 'verilog', 'vhdl', 'asic', 'pcb', 'circuits?', 'semiconductors?', 'cuda', 'gpus?'],
  },
  systems: {
    label: 'Systems',
    tags: ['systems', 'infra'],
    terms: ['c\\+\\+', 'rust', 'operating systems', 'distributed systems', 'linux', 'concurrency', 'compilers?', 'low[- ]level'],
  },
  cloud: {
    label: 'Cloud / DevOps',
    tags: ['cloud', 'devops'],
    terms: ['aws', 'gcp', 'azure', 'docker', 'kubernetes', 'devops', 'ci/cd', 'terraform'],
  },
  mobile: {
    label: 'Mobile',
    tags: ['mobile', 'ios', 'android'],
    terms: ['ios', 'android', 'swift', 'kotlin', 'react native', 'flutter', 'expo'],
  },
  fintech: {
    label: 'Fintech',
    tags: ['fintech', 'finance', 'quant'],
    terms: ['fintech', 'financial', 'banking', 'trading', 'quantitative', 'payments'],
  },
  security: {
    label: 'Security',
    tags: ['security'],
    terms: ['security', 'cybersecurity', 'cryptography', 'penetration testing'],
  },
  research: {
    label: 'Research',
    tags: ['research'],
    terms: ['research(?:er)?', 'publications?', 'undergraduate research'],
  },
};

const CONCEPT_KEYS = Object.keys(LEXICON);

/** One compiled regex per concept, built once. */
const MATCHERS: Record<string, RegExp> = Object.fromEntries(
  CONCEPT_KEYS.map((k) => [
    k,
    // (?<![\w+#.]) / (?![\w+#]) stand in for \b, which breaks on c++ and .js.
    new RegExp(`(?<![\\w+#])(?:${LEXICON[k].terms.join('|')})(?![\\w+#])`, 'gi'),
  ])
);

/* ------------------------------ vectors -------------------------------- */

/** Sparse concept vector: concept key -> weight. */
export type Vec = Record<string, number>;

/** Raw concept counts in free text. */
export function conceptCounts(text: string): Vec {
  const counts: Vec = {};
  for (const k of CONCEPT_KEYS) {
    const n = text.match(MATCHERS[k])?.length ?? 0;
    if (n > 0) counts[k] = n;
  }
  return counts;
}

/**
 * Tags implied by a posting's own words, used by the scanner to fill in rows
 * that arrive untagged (Simplify's boards give only a title, company and
 * location). Lives here so the tags the scanner writes and the concepts the
 * ranker reads can never drift apart.
 */
export function deriveTags(title: string, location: string | null): string[] {
  const tags = Object.keys(conceptCounts(`${title} ${location ?? ''}`));
  if (/\bremote\b/i.test(location ?? '')) tags.push('remote');
  return tags;
}

/** The text an opportunity is judged on, and its tag-asserted concepts. */
function opportunityCounts(o: Opportunity): Vec {
  const counts = conceptCounts(`${o.title} ${o.tags.join(' ')}`);
  const tags = o.tags.map((t) => t.toLowerCase());
  for (const k of CONCEPT_KEYS) {
    // A tag is an explicit editorial claim, so it counts even if the title is
    // silent. Weight 1 so it reads like one mention, not a trump card.
    if (LEXICON[k].tags.some((t) => tags.includes(t))) counts[k] = Math.max(counts[k] ?? 0, 1);
  }
  return counts;
}

/**
 * Smoothed IDF over the opportunity corpus: log((N + 1) / (df + 1)) + 1.
 * Concepts absent from every row still get a weight (the +1s), so a resume
 * concept with no matching job just contributes nothing to any dot product.
 */
export function buildIdf(docs: Vec[]): Vec {
  const n = docs.length;
  const idf: Vec = {};
  for (const k of CONCEPT_KEYS) {
    const df = docs.reduce((acc, d) => acc + (d[k] ? 1 : 0), 0);
    idf[k] = Math.log((n + 1) / (df + 1)) + 1;
  }
  return idf;
}

/** Sublinear TF (1 + ln count) times IDF. */
export function tfidf(counts: Vec, idf: Vec): Vec {
  const v: Vec = {};
  for (const [k, c] of Object.entries(counts)) {
    if (c > 0) v[k] = (1 + Math.log(c)) * (idf[k] ?? 1);
  }
  return v;
}

export function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of Object.entries(a)) {
    na += x * x;
    if (b[k]) dot += x * b[k];
  }
  for (const y of Object.values(b)) nb += y * y;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* ---------------------------- class year -------------------------------- */

/**
 * Expected graduation year from resume text, or null. Only trusts a year that
 * sits next to graduation language ("Expected May 2029", "Class of 2029",
 * "B.S. ... Jun 2029" within a short window), since resumes are full of other
 * years (job dates, project dates).
 */
export function gradYear(text: string, now: Date = new Date()): number | null {
  const current = now.getFullYear();
  const re =
    /\b(?:expected|anticipated|graduat\w*|class of|b\.s\.?|b\.a\.?|bs|ba|bachelor\w*)\b[^\n\d]{0,40}?((?:19|20)\d{2})/gi;
  const years: number[] = [];
  for (const m of text.matchAll(re)) {
    const y = Number(m[1]);
    if (y >= current - 1 && y <= current + 6) years.push(y);
  }
  // Several hits usually means one grad year repeated; the latest plausible
  // one is the expected graduation, not a past degree.
  return years.length ? Math.max(...years) : null;
}

/* ------------------------------ ranking -------------------------------- */

export type ResumeProfile = {
  counts: Vec;
  gradYear: number | null;
};

/**
 * Minimum distinct concepts before recommendations are shown. Below this the
 * resume was probably an image-only PDF or unreadable, and ranking on one
 * stray keyword would look confident while meaning nothing.
 */
export const MIN_CONCEPTS = 2;

export function buildProfile(resumeText: string, now: Date = new Date()): ResumeProfile | null {
  const counts = conceptCounts(resumeText);
  if (Object.keys(counts).length < MIN_CONCEPTS) return null;
  return { counts, gradYear: gradYear(resumeText, now) };
}

export type Recommendation = {
  opportunity: Opportunity;
  score: number;
  /** Human-readable reasons, strongest first. Empty = no real match. */
  reasons: string[];
};

const W_CONTENT = 1;
const W_FEEDBACK = 0.25;
/** Item-item similarity (on distinctive concepts) needed to count as "like". */
const FEEDBACK_MIN_SIM = 0.25;
const OPEN_DOOR_TAGS = ['no-experience-ok', 'first-gen-friendly', 'underrepresented'];
/** Roughly one generic-SWE match, so open-door programs sit mid-list, not on top. */
const W_OPEN_DOOR = 0.08;
/** Contribution below this is noise and does not earn a reason chip. */
const REASON_FLOOR = 0.08;

export function recommend(
  profile: ResumeProfile,
  opportunities: Opportunity[],
  actions: JobActionMap = {},
  now: Date = new Date()
): Recommendation[] {
  const docCounts = opportunities.map(opportunityCounts);
  const idf = buildIdf(docCounts);
  const resumeVec = tfidf(profile.counts, idf);
  const docVecs = docCounts.map((c) => tfidf(c, idf));

  // Item-item feedback runs on distinctive concepts only: those on at most
  // half the corpus. Otherwise a near-universal concept (swe) dominates every
  // row, so saving one SWE internship "resembles" all of them and the boost
  // turns into uniform noise, while two genuinely related roles (a firmware
  // role and a hardware/ML one) look dissimilar because swe swamps the
  // concept they share.
  const distinct = new Set(
    CONCEPT_KEYS.filter((k) => docCounts.filter((d) => d[k]).length <= opportunities.length / 2)
  );
  const pick = (v: Vec): Vec =>
    Object.fromEntries(Object.entries(v).filter(([k]) => distinct.has(k)));
  const itemVecs = docVecs.map(pick);

  // Positives: whatever the member saved or applied to, remembering which, so
  // the reason chip can say so accurately.
  const positives = opportunities
    .map((o, i) => ({
      vec: itemVecs[i],
      via: actions[o.id]?.saved ? 'saved' : actions[o.id]?.applied ? 'applied to' : null,
    }))
    .filter((p) => p.via !== null && Object.keys(p.vec).length > 0);

  const yearsLeft = profile.gradYear === null ? null : profile.gradYear - now.getFullYear();

  const out: Recommendation[] = [];
  opportunities.forEach((o, i) => {
    // Already applied: acted on, not a recommendation.
    if (actions[o.id]?.applied) return;

    const docVec = docVecs[i];
    const content = cosine(resumeVec, docVec);
    let score = W_CONTENT * content;
    const reasons: string[] = [];

    // Reasons: the concepts contributing most to the dot product.
    const contributions = Object.keys(resumeVec)
      .filter((k) => docVec[k])
      .map((k) => ({ k, w: resumeVec[k] * docVec[k] }))
      .sort((a, b) => b.w - a.w);
    const norm = contributions.reduce((acc, c) => acc + c.w, 0) || 1;
    for (const c of contributions) {
      if (content * (c.w / norm) >= REASON_FLOOR) reasons.push(LEXICON[c.k].label);
    }

    // Class-year fit.
    const tags = o.tags.map((t) => t.toLowerCase());
    if (yearsLeft !== null) {
      if (tags.includes('underclassmen')) {
        if (yearsLeft >= 3) {
          score += 0.15;
          reasons.push('Open to your class year');
        } else if (yearsLeft <= 1) {
          score -= 0.3;
        }
      }
      if (o.kind === 'new-grad') {
        if (yearsLeft <= 1) {
          score += 0.1;
          reasons.push('Graduating soon');
        } else if (yearsLeft >= 2) {
          score -= 0.35;
        }
      }
    }

    // Open-door programs. Rows tagged for first-gen, underrepresented, or
    // no-experience applicants carry no skill concepts, so pure content
    // ranking sinks them to the bottom. But every Pipeline member is who those
    // programs are for, so they get a floor instead of a zero.
    if (tags.some((t) => OPEN_DOOR_TAGS.includes(t))) {
      score += W_OPEN_DOOR;
      reasons.push('Open to all fellows');
    }

    // Implicit feedback: similarity to what the member already acted on.
    if (positives.length && !actions[o.id]?.saved) {
      let best = { sim: 0, via: '' };
      for (const p of positives) {
        const sim = cosine(p.vec, itemVecs[i]);
        if (sim > best.sim) best = { sim, via: p.via! };
      }
      if (best.sim >= FEEDBACK_MIN_SIM) {
        score += W_FEEDBACK * best.sim;
        reasons.push(`Like roles you ${best.via}`);
      }
    }

    // A role the class-year prior pushed below zero is one the member likely
    // cannot apply to; a "Software engineering" chip on it would read as an
    // endorsement.
    out.push({ opportunity: o, score, reasons: score > 0 ? reasons : [] });
  });

  // Ties (common: many rows share one concept profile) break toward fresher
  // postings, the same order the unranked feed uses.
  return out.sort(
    (a, b) => b.score - a.score || b.opportunity.postedAt.localeCompare(a.opportunity.postedAt)
  );
}

/**
 * Sample resume for demo sessions, where no real file exists. A sophomore
 * data science student leaning ML, graduating 2029.
 */
export const DEMO_RESUME_TEXT = `
Demo Fellow. B.S. Data Science, University of California, Irvine. Expected June 2029.
Skills: Python, SQL, pandas, NumPy, scikit-learn, PyTorch, React, TypeScript, Git.
Experience: Data Analyst Intern, built SQL dashboards in Tableau and automated ETL jobs.
Projects: Trained a computer vision model (YOLO) for object detection; built a neural network
from scratch with backpropagation; full-stack React app with a FastAPI backend.
Undergraduate research in machine learning with a campus lab.
`;
