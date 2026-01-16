/**
 * background-messaging.test.js - Integration tests for background message handling.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let onMessageListener;
let onAlarmListener;
let importCounter = 0;

function buildChromeMock() {
  return {
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (listener) => { onMessageListener = listener; } },
      sendMessage: () => {},
      lastError: null
    },
    alarms: {
      create: () => {},
      clear: () => {},
      getAll: () => {},
      onAlarm: { addListener: (listener) => { onAlarmListener = listener; } }
    },
    notifications: {
      create: () => {},
      clear: () => {},
      onButtonClicked: { addListener: () => {} }
    },
    storage: {
      sync: {
        get: () => {},
        set: () => {}
      }
    }
  };
}

async function loadBackground() {
  const url = new URL(`../../background.js?cache=${importCounter += 1}`, import.meta.url);
  await import(url);
}

beforeEach(async () => {
  onMessageListener = null;
  onAlarmListener = null;
  globalThis.chrome = buildChromeMock();
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'MacIntel' },
    configurable: true
  });
  await loadBackground();
});

test('updateAlarms message triggers alarm creation', () => {
  let createdAlarm = null;
  global.chrome.alarms.getAll = (callback) => callback([]);
  global.chrome.alarms.create = (name, options) => {
    createdAlarm = { name, options };
  };

  onMessageListener({
    action: 'updateAlarms',
    settings: {
      blinkEnabled: true,
      blinkInterval: 10,
      waterEnabled: false,
      waterInterval: 0,
      upEnabled: false,
      upInterval: 0,
      stretchEnabled: false,
      stretchInterval: 0
    }
  }, {}, () => {});

  assert.equal(createdAlarm.name, 'blink');
  assert.equal(createdAlarm.options.delayInMinutes, 10);
});

test('createOneTimeTimer message schedules a one-time alarm', () => {
  let createdAlarm = null;
  global.chrome.alarms.create = (name, options) => {
    createdAlarm = { name, options };
  };

  onMessageListener({ action: 'createOneTimeTimer', minutes: 5 }, {}, () => {});

  assert.equal(createdAlarm.name, 'oneTime');
  assert.equal(createdAlarm.options.delayInMinutes, 5);
});

test('one-time alarm notifies popup of completion', () => {
  let sentMessage = null;
  global.chrome.storage.sync.get = (keys, callback) => callback({ soundEnabled: true });
  global.chrome.runtime.sendMessage = (message) => { sentMessage = message; };
  global.chrome.notifications.create = () => {};

  onAlarmListener({ name: 'oneTime' });

  assert.deepEqual(sentMessage, { action: 'timerComplete' });
});

test('water alarm creates notification with buttons and macOS interaction settings', () => {
  let notificationOptions = null;
  global.chrome.storage.sync.get = (keys, callback) => callback({ soundEnabled: true });
  global.chrome.notifications.create = (id, options) => { notificationOptions = options; };

  onAlarmListener({ name: 'water' });

  assert.ok(Array.isArray(notificationOptions.buttons));
  assert.equal(notificationOptions.requireInteraction, false);
});

test('repeating alarm recreates itself with stored interval', () => {
  let createdAlarm = null;
  global.chrome.storage.sync.get = (keys, callback) => {
    if (keys.includes('soundEnabled')) {
      callback({ soundEnabled: true });
      return;
    }
    callback({ blinkInterval: 15 });
  };
  global.chrome.alarms.create = (name, options) => {
    createdAlarm = { name, options };
  };
  global.chrome.notifications.create = () => {};

  onAlarmListener({ name: 'blink' });

  assert.equal(createdAlarm.name, 'blink');
  assert.equal(createdAlarm.options.delayInMinutes, 15);
});
