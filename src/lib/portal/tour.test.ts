/**
 * Tests for the tour's step machine. The interesting cases are all about the
 * portal being multi-page: the tour has to survive a page load and must not
 * show a step that belongs somewhere else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crossesPage,
  isLastStep,
  nextIndex,
  stepOnPage,
  stepsForPage,
  TOUR_STEPS,
} from './tour.ts';

test('every step names a page and a target the overlay can find', () => {
  for (const s of TOUR_STEPS) {
    assert.ok(s.target.startsWith('[data-tour='), `${s.key} target: ${s.target}`);
    assert.ok(['home', 'opportunities', 'tracker'].includes(s.page), s.key);
    assert.ok(s.title.length > 0 && s.body.length > 0, s.key);
  }
});

test('step keys are unique, so stored progress is unambiguous', () => {
  const keys = TOUR_STEPS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('a step is only shown on its own page', () => {
  assert.equal(stepOnPage(0, 'home')?.key, 'resume');
  // Step 0 lives on home; asking for it on another page yields nothing
  // rather than a substitute.
  assert.equal(stepOnPage(0, 'opportunities'), null);
  assert.equal(stepOnPage(2, 'opportunities')?.key, 'foryou');
  assert.equal(stepOnPage(2, 'home'), null);
});

test('an out-of-range index yields nothing instead of throwing', () => {
  assert.equal(stepOnPage(99, 'home'), null);
  assert.equal(stepOnPage(-1, 'home'), null);
});

test('stepsForPage keeps absolute indexes, so resuming is correct', () => {
  const onOpportunities = stepsForPage('opportunities');
  assert.deepEqual(
    onOpportunities.map((s) => s.index),
    [2, 3]
  );
  assert.equal(onOpportunities[0].step.key, 'foryou');
});

test('the tour ends after the last step', () => {
  const last = TOUR_STEPS.length - 1;
  assert.equal(isLastStep(last), true);
  assert.equal(nextIndex(last), null);
  assert.equal(nextIndex(0), 1);
});

test('crossesPage marks exactly the steps that need a navigation', () => {
  // Only one page change in the whole tour: home -> opportunities.
  const crossings = TOUR_STEPS.map((_, i) => crossesPage(i)).filter(Boolean);
  assert.equal(crossings.length, 1);
  assert.equal(crossesPage(1), true);
  assert.equal(crossesPage(0), false);
  // The final step has nothing after it, so it never counts as a crossing.
  assert.equal(crossesPage(TOUR_STEPS.length - 1), false);
});

test('a step that changes page carries where to go', () => {
  const crossing = TOUR_STEPS.findIndex((_, i) => crossesPage(i));
  assert.ok(TOUR_STEPS[crossing].href, 'crossing step needs an href');
  assert.equal(TOUR_STEPS[crossing].href!('/portal/uci'), '/portal/uci/opportunities/');
});
