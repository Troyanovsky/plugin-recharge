/**
 * popup-utils.test.js - Unit tests for popup helper functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidInterval,
  updateWaterLogBadge,
  updateButtonCountdown
} from '../../popup.js';

test('isValidInterval validates repeating intervals', () => {
  assert.equal(isValidInterval(0), true);
  assert.equal(isValidInterval(60), true);
  assert.equal(isValidInterval(-1), false);
  assert.equal(isValidInterval(61), false);
  assert.equal(isValidInterval('10'), true);
});

test('updateWaterLogBadge toggles badge visibility and text', () => {
  const badge = { textContent: '', style: { display: '' } };
  global.document = {
    getElementById: (id) => (id === 'waterLogBadge' ? badge : null)
  };

  updateWaterLogBadge(0);
  assert.equal(badge.textContent, 0);
  assert.equal(badge.style.display, 'none');

  updateWaterLogBadge(3);
  assert.equal(badge.textContent, 3);
  assert.equal(badge.style.display, 'flex');

  delete global.document;
});

test('updateButtonCountdown renders a mm:ss countdown', () => {
  const button = { textContent: '' };
  global.document = {
    getElementById: (id) => (id === 'startTimerBtn' ? button : null)
  };

  const now = Date.now();
  const endTime = now + 61 * 1000;

  const originalNow = Date.now;
  Date.now = () => now;
  try {
    updateButtonCountdown(endTime);
  } finally {
    Date.now = originalNow;
  }

  assert.equal(button.textContent, '1:01');

  delete global.document;
});
