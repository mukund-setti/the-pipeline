/**
 * Tests for the two rules that decide what the feed hides and what the home
 * page nudges. Both are pure, so they run under node --test with no browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completedCount, firstRunItems, nextStep } from './firstRun.ts';
import { isHiddenByAge, isOlder, OLDER_AFTER_DAYS } from '../jobs/age.ts';

const NOW = new Date('2026-10-09T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/* ------------------------------ posting age ----------------------------- */

test('isOlder splits on the cutoff', () => {
  assert.equal(isOlder(daysAgo(1), NOW), false);
  assert.equal(isOlder(daysAgo(OLDER_AFTER_DAYS - 1), NOW), false);
  assert.equal(isOlder(daysAgo(OLDER_AFTER_DAYS + 1), NOW), true);
});

test('an unreadable date is not treated as old', () => {
  // Better a stale row in the feed than silently hiding a good one.
  assert.equal(isOlder('not a date', NOW), false);
  assert.equal(isOlder('', NOW), false);
});

test("a member's own saved or applied roles are never hidden by age", () => {
  const old = daysAgo(400);
  assert.equal(isHiddenByAge(old, undefined, NOW), true);
  assert.equal(isHiddenByAge(old, {}, NOW), true);
  assert.equal(isHiddenByAge(old, { saved: true }, NOW), false);
  assert.equal(isHiddenByAge(old, { applied: true }, NOW), false);
});

test('recent roles are shown whether or not they are marked', () => {
  const fresh = daysAgo(3);
  assert.equal(isHiddenByAge(fresh, undefined, NOW), false);
  assert.equal(isHiddenByAge(fresh, { saved: true }, NOW), false);
});

/* ---------------------------- first-run steps --------------------------- */

const facts = (over: Partial<Parameters<typeof nextStep>[0]> = {}) => ({
  hasResume: false,
  viewedMatches: false,
  trackedCount: 0,
  ...over,
});

test('the checklist advances in order', () => {
  assert.equal(nextStep(facts()), 'resume');
  assert.equal(nextStep(facts({ hasResume: true })), 'matches');
  assert.equal(nextStep(facts({ hasResume: true, viewedMatches: true })), 'track');
});

test('a finished checklist reports nothing left, which hides the card', () => {
  assert.equal(
    nextStep(facts({ hasResume: true, viewedMatches: true, trackedCount: 1 })),
    null
  );
});

test('steps resolve in order, so the card never jumps backwards', () => {
  // Tracked something before uploading a resume: still asked for the resume
  // first, because matches depend on it.
  assert.equal(nextStep(facts({ trackedCount: 3 })), 'resume');
});

test('deleting a resume honestly un-checks that step', () => {
  const after = facts({ hasResume: false, viewedMatches: true, trackedCount: 2 });
  assert.equal(nextStep(after), 'resume');
  assert.equal(completedCount(after), 2);
});

test('counts match what the card renders', () => {
  assert.equal(completedCount(facts()), 0);
  assert.equal(completedCount(facts({ hasResume: true })), 1);
  assert.equal(firstRunItems(facts()).length, 3);
});
