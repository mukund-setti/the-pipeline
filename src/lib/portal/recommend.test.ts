/**
 * Recommender tests + a small labeled evaluation. Run with `npm test`
 * (node --test, no test framework dependency).
 *
 * The eval ranks three persona resumes against the same twelve roles the demo
 * portal seeds, and asserts what a fellow reviewing the list by hand would
 * expect at the top. It is the regression guard for LEXICON and weight
 * changes: if a tweak makes the ML student's top three contain a new-grad
 * role, this fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Opportunity } from './types.ts';
import {
  buildProfile,
  conceptCounts,
  cosine,
  DEMO_RESUME_TEXT,
  gradYear,
  recommend,
} from './recommend.ts';

const NOW = new Date('2026-09-19T12:00:00Z');

/** Mirrors seedOpportunities() in data.ts (ids, titles, kinds, tags). */
const mk = (
  company: string,
  title: string,
  kind: Opportunity['kind'],
  tags: string[],
  daysAgo: number
): Opportunity => ({
  id: company.toLowerCase().replace(/\W+/g, '-') + '-' + kind,
  company,
  title,
  kind,
  tags,
  url: 'https://example.com',
  source: 'test',
  location: null,
  deadline: null,
  postedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
});

const JOBS: Opportunity[] = [
  mk('Amazon', 'Software Engineer Intern, Summer 2027', 'internship', ['swe', 'big-tech'], 0),
  mk('Capital One', 'Technology Internship Program (TIP)', 'internship', ['swe', 'fintech', 'referral-available'], 1),
  mk('Google', 'STEP Intern, First & Second Year Students', 'internship', ['swe', 'underclassmen'], 1),
  mk('Microsoft', 'Explore Program (First/Second Year)', 'internship', ['swe', 'underclassmen'], 2),
  mk('Break Through Tech', 'AI Program, Spring Cohort', 'program', ['ai-ml', 'first-gen-friendly', 'no-experience-ok'], 2),
  mk('MLT', 'Career Prep Fellowship', 'program', ['fellowship', 'underrepresented'], 3),
  mk('Bloomberg', 'Software Engineer Intern, Summer 2027', 'internship', ['swe', 'nyc'], 4),
  mk('NVIDIA', 'Software Engineering Intern', 'internship', ['swe', 'hardware', 'ai-ml'], 5),
  mk('Uber', 'Software Engineer, New Grad 2027', 'new-grad', ['swe', 'new-grad'], 6),
  mk('CodePath', 'Tech Fellowship, Intro Track', 'program', ['courses', 'free', 'no-experience-ok'], 7),
  mk('Datadog', 'Software Engineer, New Grad', 'new-grad', ['swe', 'new-grad', 'nyc'], 8),
  mk('SpaceX', 'Firmware Intern, Summer 2027', 'internship', ['embedded', 'hardware'], 9),
];

const top = (resume: string, n: number, actions = {}) => {
  const profile = buildProfile(resume, NOW);
  assert.ok(profile, 'profile should build');
  return recommend(profile, JOBS, actions, NOW)
    .slice(0, n)
    .map((r) => r.opportunity.company);
};

const rankOf = (resume: string, company: string) => {
  const ranked = recommend(buildProfile(resume, NOW)!, JOBS, {}, NOW);
  return ranked.findIndex((r) => r.opportunity.company === company);
};

/* ------------------------------ units --------------------------------- */

test('conceptCounts maps surface terms to concepts', () => {
  const c = conceptCounts('Built models in PyTorch and scikit-learn; C++ and Rust; React + Next.js');
  assert.equal(c['ai-ml'], 2);
  assert.equal(c.systems, 2);
  assert.equal(c.frontend, 2);
});

test('conceptCounts does not fire inside other words', () => {
  const c = conceptCounts('Exposure to reactive programming; Swiftly delivered; Ioslation');
  assert.equal(c.frontend, undefined);
  assert.equal(c.mobile, undefined);
});

test('cosine is 1 for parallel, 0 for disjoint, 0 for empty', () => {
  assert.equal(cosine({ a: 2, b: 4 }, { a: 1, b: 2 }).toFixed(6), '1.000000');
  assert.equal(cosine({ a: 1 }, { b: 1 }), 0);
  assert.equal(cosine({}, { a: 1 }), 0);
});

test('gradYear trusts years next to graduation language only', () => {
  assert.equal(gradYear('B.S. Computer Science. Expected June 2029.', NOW), 2029);
  assert.equal(gradYear('Class of 2028', NOW), 2028);
  // A job date is not a graduation year.
  assert.equal(gradYear('Data Intern, Summer 2027. Worked on jobs in 2026.', NOW), null);
});

test('an unreadable resume yields no profile rather than a confident guess', () => {
  assert.equal(buildProfile('Jane Doe  555-0100  jane@example.com', NOW), null);
  assert.equal(buildProfile('', NOW), null);
});

/* ------------------------------ eval ---------------------------------- */

test('eval: ML-leaning sophomore gets AI/ML and underclassmen roles, not new grad', () => {
  const best = top(DEMO_RESUME_TEXT, 3);
  const expected = new Set(['NVIDIA', 'Break Through Tech', 'Google', 'Microsoft']);
  for (const c of best) assert.ok(expected.has(c), `unexpected ${c} in top 3: ${best.join(', ')}`);
  // New-grad roles are ineligible for a 2029 grad and must sit in the bottom half.
  assert.ok(rankOf(DEMO_RESUME_TEXT, 'Uber') >= JOBS.length / 2);
  assert.ok(rankOf(DEMO_RESUME_TEXT, 'Datadog') >= JOBS.length / 2);
});

const EMBEDDED = `
B.S. Electrical Engineering, expected May 2027.
Firmware for STM32 microcontrollers in C; RTOS scheduling; PCB layout; Verilog on an FPGA.
Robotics club: embedded motor control on Arduino and Raspberry Pi.
`;

test('eval: embedded/hardware junior gets SpaceX and NVIDIA first', () => {
  const best = top(EMBEDDED, 2);
  assert.deepEqual(new Set(best), new Set(['SpaceX', 'NVIDIA']));
  // Graduating in a year: first/second-year programs are out of reach.
  assert.ok(rankOf(EMBEDDED, 'Google') > rankOf(EMBEDDED, 'Amazon'));
});

const SENIOR_WEB = `
B.S. Computer Science, Class of 2027.
Full-stack software engineer: React, TypeScript, Node.js, Express, PostgreSQL, Docker.
Built REST APIs and a GraphQL gateway; deployed on AWS.
`;

test('eval: graduating full-stack senior sees new-grad roles surface', () => {
  const best = top(SENIOR_WEB, 3);
  assert.ok(best.includes('Uber') || best.includes('Datadog'), `top 3: ${best.join(', ')}`);
  assert.ok(!best.includes('Google') && !best.includes('Microsoft'));
});

/* ---------------------------- behaviour ------------------------------- */

test('applied roles drop out of recommendations', () => {
  const ranked = recommend(
    buildProfile(DEMO_RESUME_TEXT, NOW)!,
    JOBS,
    { 'nvidia-internship': { applied: true } },
    NOW
  );
  assert.ok(!ranked.some((r) => r.opportunity.company === 'NVIDIA'));
});

test('saving a role lifts similar roles and says why', () => {
  const profile = buildProfile(EMBEDDED, NOW)!;
  const before = recommend(profile, JOBS, {}, NOW).find((r) => r.opportunity.company === 'NVIDIA')!;
  const after = recommend(profile, JOBS, { 'spacex-internship': { saved: true } }, NOW).find(
    (r) => r.opportunity.company === 'NVIDIA'
  )!;
  assert.ok(after.score > before.score);
  assert.ok(after.reasons.includes('Like roles you saved'));
});

test('saving a generic SWE role does not mark every SWE role as similar', () => {
  const ranked = recommend(
    buildProfile(SENIOR_WEB, NOW)!,
    JOBS,
    { 'capital-one-internship': { saved: true } },
    NOW
  );
  const flagged = ranked.filter((r) => r.reasons.some((x) => x.startsWith('Like roles you')));
  assert.equal(flagged.length, 0, flagged.map((r) => r.opportunity.company).join(', '));
});

test('top recommendations carry at least one reason', () => {
  const ranked = recommend(buildProfile(DEMO_RESUME_TEXT, NOW)!, JOBS, {}, NOW);
  for (const r of ranked.slice(0, 3)) assert.ok(r.reasons.length > 0, r.opportunity.company);
});
