/**
 * background.js - Service Worker for Recharge Chrome Extension
 *
 * Manages alarms, notifications, and storage for break reminders.
 *
 * Key patterns:
 * - Alarms recreate on each trigger with updated intervals (not periodic)
 * - Water notifications use unique timestamp IDs for button tracking
 * - Water log counter uses serialization queue to prevent race conditions
 */

const NOTIFICATION_MESSAGES = {
  blink: "Time to blink your eyes! Look away from the screen for 20 seconds.",
  water: "Time to drink some water! Stay hydrated!",
  up: "Time to get up and walk around for a few minutes!",
  stretch: "Time to do some stretching exercises!",
  oneTime: "Your timer is up!"
};

const DEBUG_MODE = false;  // Temporarily set true when diagnosing issues

// Water log increment queue to prevent race conditions from rapid clicks
let waterLogQueue = [];
let isProcessingWaterLogQueue = false;
const WATER_LOG_MAX_RETRIES = 5;
const WATER_LOG_RETRY_DELAY_MS = 500;

// Stores the last applied alarm settings in chrome.storage.local so updateAlarms
// can avoid rescheduling unrelated alarms (e.g., when only sound settings change).
const ALARM_STATE_STORAGE_KEY = 'alarmStateV1';

// One-time timer UI state persisted to chrome.storage.local to allow popup restore.
const ONE_TIME_STATE_STORAGE_KEY = 'oneTimeStateV1';

// Audio playback on platforms where notification sounds are unreliable.
const SOUND_SUPPORT_STORAGE_KEY = 'soundPlaybackSupportedV1';
const OFFSCREEN_DOCUMENT_URL = 'offscreen.html';
let isOffscreenDocumentReady = false;
let isOffscreenListenerReady = false;
let offscreenReadyWaiters = [];

// Cached platform check to avoid repeated getPlatformInfo calls.
let cachedIsMacOS = null;

/**
 * Calls a Chrome API that may be callback- or promise-based and returns a Promise.
 * @template T
 * @param {(cb: (result: T) => void) => (Promise<T> | void)} fn
 * @returns {Promise<T>}
 */
function callChromeApi(fn) {
  return new Promise((resolve, reject) => {
    try {
      const maybePromise = fn((result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result);
      });

      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve, reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Checks whether an offscreen document currently exists.
 * @returns {Promise<boolean>}
 */
async function hasOffscreenDocument() {
  if (!chrome.offscreen?.hasDocument) {
    return false;
  }

  try {
    return await callChromeApi((cb) => chrome.offscreen.hasDocument(cb));
  } catch (error) {
    // Some Chrome builds expose promise-only APIs; fall back to calling without a callback.
    try {
      const maybePromise = chrome.offscreen.hasDocument();
      if (maybePromise && typeof maybePromise.then === 'function') {
        return await maybePromise;
      }
    } catch {
      // Ignore and report below.
    }
    if (DEBUG_MODE) console.error('Failed to query offscreen document state:', error);
    return false;
  }
}

/**
 * Creates the offscreen document for audio playback.
 * @returns {Promise<void>}
 */
async function createOffscreenDocument() {
  const options = {
    url: OFFSCREEN_DOCUMENT_URL,
    reasons: chrome.offscreen?.Reason?.AUDIO_PLAYBACK
      ? [chrome.offscreen.Reason.AUDIO_PLAYBACK]
      : ['AUDIO_PLAYBACK'],
    justification: 'Play a short notification sound when required.'
  };
  try {
    await callChromeApi((cb) => chrome.offscreen.createDocument(options, cb));
  } catch (error) {
    // Some Chrome builds expose promise-only APIs; fall back to calling without a callback.
    const maybePromise = chrome.offscreen.createDocument(options);
    if (maybePromise && typeof maybePromise.then === 'function') {
      await maybePromise;
      return;
    }
    throw error;
  }
}

// Validation constants for timer and interval values
// NOTE: These are duplicated from constants.js because service workers
// don't support ES6 module imports. When updating, keep both files in sync.
const ONE_TIME_MIN = 1;
const ONE_TIME_MAX = 120;
const REPEATING_INTERVAL_MIN = 0;
const REPEATING_INTERVAL_MAX = 60;

// Default values for interval sliders (in minutes)
const DEFAULT_BLINK_INTERVAL = 20;
const DEFAULT_WATER_INTERVAL = 30;
const DEFAULT_UP_INTERVAL = 45;
const DEFAULT_STRETCH_INTERVAL = 40;

// Default values for feature toggles
const DEFAULT_SOUND_ENABLED = true;
const DEFAULT_BLINK_ENABLED = false;
const DEFAULT_WATER_ENABLED = false;
const DEFAULT_UP_ENABLED = false;
const DEFAULT_STRETCH_ENABLED = false;

chrome.runtime.onInstalled.addListener(() => {
  if (DEBUG_MODE) console.log('Extension installed/updated');
  
  // Initialize default settings
  chrome.storage.sync.get([
    'blinkEnabled', 'blinkInterval',
    'waterEnabled', 'waterInterval',
    'upEnabled', 'upInterval',
    'stretchEnabled', 'stretchInterval',
    'soundEnabled',
    'waterLogCount', 'waterLogDate'
  ], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to read storage during initialization:', chrome.runtime.lastError);
      return;
    }

    const today = new Date().toDateString();
    const defaultSettings = {
      blinkEnabled: result.blinkEnabled ?? DEFAULT_BLINK_ENABLED,
      blinkInterval: result.blinkInterval ?? DEFAULT_BLINK_INTERVAL,
      waterEnabled: result.waterEnabled ?? DEFAULT_WATER_ENABLED,
      waterInterval: result.waterInterval ?? DEFAULT_WATER_INTERVAL,
      upEnabled: result.upEnabled ?? DEFAULT_UP_ENABLED,
      upInterval: result.upInterval ?? DEFAULT_UP_INTERVAL,
      stretchEnabled: result.stretchEnabled ?? DEFAULT_STRETCH_ENABLED,
      stretchInterval: result.stretchInterval ?? DEFAULT_STRETCH_INTERVAL,
      soundEnabled: result.soundEnabled ?? DEFAULT_SOUND_ENABLED,
      waterLogCount: (result.waterLogDate === today) ? result.waterLogCount : 0,
      waterLogDate: today
    };
    if (DEBUG_MODE) console.log('Default settings:', defaultSettings);

    chrome.storage.sync.set(defaultSettings, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save default settings:', chrome.runtime.lastError);
        return;
      }
      updateAlarms(defaultSettings);
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'offscreenReady') {
    isOffscreenListenerReady = true;
    offscreenReadyWaiters.forEach((resolve) => resolve(true));
    offscreenReadyWaiters = [];
    sendResponse?.({ ok: true });
    return;
  }
  if (message.action === 'updateAlarms') {
    updateAlarms(message.settings);
    sendResponse?.({ ok: true });
  }
  if (message.action === 'createOneTimeTimer') {
    const minutes = message.minutes;
    if (isValidAlarmInterval(minutes)) {
      const durationMinutes = Number(minutes);
      const scheduledTime = Date.now() + durationMinutes * 60 * 1000;
      chrome.alarms.create('oneTime', {
        delayInMinutes: minutes
      });
      chrome.storage.local.set({
        [ONE_TIME_STATE_STORAGE_KEY]: { scheduledTime, durationMinutes }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to persist one-time timer state:', chrome.runtime.lastError);
        }
      });
      if (DEBUG_MODE) console.log(`Created one-time timer for ${minutes} minutes`);
      sendResponse?.({ ok: true });
    } else {
      console.error(`Invalid one-time timer value: ${minutes}. Must be between ${ONE_TIME_MIN} and ${ONE_TIME_MAX} minutes.`);
      sendResponse?.({ ok: false, error: 'invalid_timer_value' });
    }
  }
  if (message.action === 'cancelOneTimeTimer') {
    chrome.alarms.clear('oneTime', () => {
      chrome.storage.local.remove([ONE_TIME_STATE_STORAGE_KEY], () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to clear one-time timer state:', chrome.runtime.lastError);
        }
        sendResponse?.({ ok: true });
      });
    });
    return true;
  }
});

/**
 * Waits for the offscreen document to register its message listener.
 * Only used when we observe a delivery failure, to avoid slowing normal paths.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function waitForOffscreenListenerReady(timeoutMs = 500) {
  if (isOffscreenListenerReady) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    offscreenReadyWaiters.push(resolve);
    setTimeout(() => {
      const index = offscreenReadyWaiters.indexOf(resolve);
      if (index !== -1) {
        offscreenReadyWaiters.splice(index, 1);
      }
      resolve(false);
    }, timeoutMs);
  });
}

/**
 * Ensures the offscreen document is available for audio playback.
 * @returns {Promise<boolean>}
 */
async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    return false;
  }

  if (await hasOffscreenDocument()) {
    isOffscreenDocumentReady = true;
    return true;
  }

  if (isOffscreenDocumentReady && !chrome.offscreen?.hasDocument) {
    // Best-effort fallback for older Chrome builds.
    return true;
  }

  try {
    isOffscreenListenerReady = false;
    await createOffscreenDocument();
    isOffscreenDocumentReady = true;
    chrome.storage.local.set({ [SOUND_SUPPORT_STORAGE_KEY]: true });
    if (chrome.offscreen?.hasDocument && !(await hasOffscreenDocument())) {
      isOffscreenDocumentReady = false;
      chrome.storage.local.set({ [SOUND_SUPPORT_STORAGE_KEY]: false });
      return false;
    }
    return true;
  } catch (error) {
    // Chrome throws if an offscreen document already exists.
    const message = String(error?.message ?? error);
    if (/only a single offscreen document/i.test(message) || /already exists/i.test(message)) {
      isOffscreenDocumentReady = true;
      chrome.storage.local.set({ [SOUND_SUPPORT_STORAGE_KEY]: true });
      return true;
    }
    if (DEBUG_MODE) console.error('Failed to create offscreen document:', error);
    chrome.storage.local.set({ [SOUND_SUPPORT_STORAGE_KEY]: false });
    return false;
  }
}

/**
 * Attempts to play a notification sound on macOS using an offscreen document.
 * If audio cannot be played, a flag is stored so the UI can inform the user.
 * @param {boolean} soundEnabled
 */
function playNotificationSoundIfNeeded(alarmName, soundEnabled) {
  if (!soundEnabled) {
    if (DEBUG_MODE) console.log('[sound] sound disabled; skip');
    return;
  }

  getIsMacOS((isMacOS) => {
    if (!isMacOS) {
      if (DEBUG_MODE) console.log('[sound] non-macOS; rely on notification sound');
      return;
    }

    if (DEBUG_MODE) console.log(`[sound] macOS detected; attempting offscreen beep (alarm=${alarmName})`);
    ensureOffscreenDocument()
      .then((ready) => {
        if (DEBUG_MODE) console.log(`[sound] offscreen ready=${ready}`);
        if (!ready) {
          chrome.runtime.sendMessage({ action: 'soundPlaybackUnsupported' }, () => {});
          return;
        }
        const sendDelayMs = 50;
        const sendPlayMessage = (attempt) => {
          chrome.runtime.sendMessage({ action: 'playNotificationSound', alarmName }, (response) => {
            if (chrome.runtime.lastError) {
              if (DEBUG_MODE) console.log('[sound] sendMessage error:', chrome.runtime.lastError);
              if (DEBUG_MODE && chrome.runtime?.getContexts) {
                chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }, (contexts) => {
                  if (chrome.runtime.lastError) return;
                  console.log('[sound] offscreen contexts:', contexts?.length ?? 0);
                });
              }

              // Offscreen documents can be reclaimed by Chrome; retry once by recreating it.
              if (attempt === 0) {
                isOffscreenDocumentReady = false;
                isOffscreenListenerReady = false;
                ensureOffscreenDocument().then((retryReady) => {
                  if (DEBUG_MODE) console.log(`[sound] offscreen retry ready=${retryReady}`);
                  if (retryReady) {
                    waitForOffscreenListenerReady().then(() => {
                      setTimeout(() => sendPlayMessage(1), sendDelayMs);
                    });
                  }
                });
              }
              return;
            }
            if (DEBUG_MODE) console.log('[sound] playNotificationSound response:', response);
            isOffscreenListenerReady = true;
          });
        };
        setTimeout(() => sendPlayMessage(0), sendDelayMs);
      })
      .catch(() => {
        if (DEBUG_MODE) console.log('[sound] ensureOffscreenDocument threw; marking unsupported');
        chrome.storage.local.set({ [SOUND_SUPPORT_STORAGE_KEY]: false });
        chrome.runtime.sendMessage({ action: 'soundPlaybackUnsupported' }, () => {});
      });
  });
}

/**
 * Determines if the current platform is macOS.
 * Uses chrome.runtime.getPlatformInfo() when available and falls back to
 * userAgent heuristics when necessary.
 * @param {(isMacOS: boolean) => void} callback
 */
function getIsMacOS(callback) {
  if (cachedIsMacOS !== null) {
    callback(cachedIsMacOS);
    return;
  }

  if (chrome.runtime?.getPlatformInfo) {
    chrome.runtime.getPlatformInfo((platformInfo) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to detect platform:', chrome.runtime.lastError);
      } else if (platformInfo?.os) {
        cachedIsMacOS = platformInfo.os === 'mac';
        callback(cachedIsMacOS);
        return;
      }

      cachedIsMacOS = /Mac|MacIntel/.test(navigator.userAgent);
      callback(cachedIsMacOS);
    });
    return;
  }

  cachedIsMacOS = /Mac|MacIntel/.test(navigator.userAgent);
  callback(cachedIsMacOS);
}

/**
 * Validates if a value is a valid alarm interval (1-120 minutes for one-time timers).
 * NOTE: This validation is also performed in popup.js before sending.
 * This defense-in-depth approach ensures data integrity even if
 * storage is corrupted or messages are modified in transit.
 * @param {number} value - The interval value to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidAlarmInterval(value) {
  return !isNaN(value) && value >= ONE_TIME_MIN && value <= ONE_TIME_MAX;
}

/**
 * Validates if a value is a valid repeating alarm interval (0-60 minutes).
 * NOTE: This validation is also performed in popup.js before sending.
 * This defense-in-depth approach ensures data integrity even if
 * storage is corrupted or messages are modified in transit.
 * @param {number} value - The interval value to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidRepeatingInterval(value) {
  return !isNaN(value) && value >= REPEATING_INTERVAL_MIN && value <= REPEATING_INTERVAL_MAX;
}

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('water_')) {
    if (buttonIndex === 0) { // Log Water button clicked
      // Add increment operation to queue for serialized processing
      waterLogQueue.push({ timestamp: Date.now(), attempts: 0 });
      processWaterLogQueue();
    }
    // For both buttons, clear the notification
    chrome.notifications.clear(notificationId);
  }
});

// Helper function to create notifications with consistent options
function createNotification(alarmName, soundEnabled, options = {}) {
  const baseOptions = {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Recharge',
    message: NOTIFICATION_MESSAGES[alarmName],
    silent: !(soundEnabled ?? DEFAULT_SOUND_ENABLED)
  };
  
  // Create a clean copy of options without any custom properties
  const { isWater, ...cleanOptions } = options;
  const notificationOptions = { ...baseOptions, ...cleanOptions };
  const notificationId = isWater ? `water_${Date.now()}` : undefined;
  
  const createCallback = (createdId) => {
    if (chrome.runtime.lastError) {
      console.error('Notification error:', chrome.runtime.lastError);
    } else if (DEBUG_MODE && createdId) {
      console.log(`Notification created with ID: ${createdId}`);
    }
  };

  if (notificationId) {
    chrome.notifications.create(notificationId, notificationOptions, createCallback);
  } else {
    chrome.notifications.create(notificationOptions, createCallback);
  }
  
  if (DEBUG_MODE) {
    console.log(`Notification created for ${alarmName}, sound ${soundEnabled ? 'enabled' : 'disabled'}`);
  }
  
  return notificationId;
}

/**
 * Processes water log increment queue sequentially to prevent race conditions.
 * Each operation performs an atomic read-modify-write on the water log counter.
 * Operations are only removed from queue after successful completion.
 */
function processWaterLogQueue() {
  if (isProcessingWaterLogQueue || waterLogQueue.length === 0) {
    return;
  }

  isProcessingWaterLogQueue = true;

  // Perform atomic read-modify-write
  chrome.storage.sync.get(['waterLogCount', 'waterLogDate'], (result) => {
    const currentOperation = waterLogQueue[0];
    if (chrome.runtime.lastError) {
      console.error('Failed to read water log:', chrome.runtime.lastError);
      if (!handleWaterLogRetry(currentOperation)) {
        console.error('Dropping water log operation after max retries.');
        waterLogQueue.shift();
      }
      isProcessingWaterLogQueue = false;
      processWaterLogQueue();
      return;
    }

    const today = new Date().toDateString();
    let waterLogCount = result.waterLogCount || 0;
    const waterLogDate = result.waterLogDate || '';

    // Reset counter if it's a new day
    if (waterLogDate !== today) {
      waterLogCount = 0;
    }

    // Increment water log count
    waterLogCount++;

    // Save updated count and date
    chrome.storage.sync.set({
      waterLogCount: waterLogCount,
      waterLogDate: today
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save water log:', chrome.runtime.lastError);
        if (!handleWaterLogRetry(currentOperation)) {
          console.error('Dropping water log operation after max retries.');
          waterLogQueue.shift();
        }
        isProcessingWaterLogQueue = false;
        processWaterLogQueue();
        return;
      }

      // Only remove from queue after successful write
      waterLogQueue.shift();

      if (DEBUG_MODE) {
        console.log(`Water logged! Count: ${waterLogCount}, Queue remaining: ${waterLogQueue.length}`);
      }

      // Notify popup to update the counter display
      chrome.runtime.sendMessage({ action: 'waterLogged', count: waterLogCount }, () => {
        if (chrome.runtime.lastError) {
          if (DEBUG_MODE) console.log('Popup not open, could not send water logged message');
        }
      });

      // Process next operation in queue
      isProcessingWaterLogQueue = false;
      processWaterLogQueue();
    });
  });
}

/**
 * Increments the retry counter and schedules a delayed retry.
 * Returns true if another retry will be attempted.
 */
function handleWaterLogRetry(operation) {
  if (!operation) {
    return false;
  }

  operation.attempts += 1;
  if (operation.attempts > WATER_LOG_MAX_RETRIES) {
    return false;
  }

  setTimeout(() => {
    processWaterLogQueue();
  }, WATER_LOG_RETRY_DELAY_MS);
  return true;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (DEBUG_MODE) console.log(`Alarm triggered: ${alarm.name}`);
  
  chrome.storage.sync.get(['soundEnabled'], (result) => {
    const soundEnabled = result.soundEnabled ?? DEFAULT_SOUND_ENABLED;
    playNotificationSoundIfNeeded(alarm.name, soundEnabled);
    if (alarm.name === 'water') {
      // Create notification with buttons for water alarm
      getIsMacOS((isMacOS) => {
        if (DEBUG_MODE) console.log(`Platform detected: ${isMacOS ? 'macOS' : 'other'}, setting requireInteraction to ${!isMacOS}`);

        createNotification(alarm.name, soundEnabled, {
          silent: isMacOS ? true : !soundEnabled,
          buttons: [
            { title: 'Log Water' },
            { title: 'Skip' }
          ],
          requireInteraction: !isMacOS, // Set to false on macOS, true on other platforms
          isWater: true // This is a custom property that will be extracted before creating the notification
        });
      });
    } else {
      // Regular notification for other alarms
      getIsMacOS((isMacOS) => {
        createNotification(alarm.name, soundEnabled, {
          silent: isMacOS ? true : !soundEnabled
        });
      });
    }

    if (alarm.name === 'oneTime') {
      // Notify popup that timer is complete
      chrome.runtime.sendMessage({ action: 'timerComplete' }, () => {
        if (chrome.runtime.lastError) {
          if (DEBUG_MODE) console.log('Popup not open, could not send timer complete message');
        }
      });
      chrome.storage.local.remove([ONE_TIME_STATE_STORAGE_KEY], () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to clear one-time timer state:', chrome.runtime.lastError);
        }
      });
    } else {
      // Restart repeating alarms as before
      chrome.storage.sync.get([`${alarm.name}Interval`], (result) => {
        const interval = result[`${alarm.name}Interval`];
        if (interval && isValidRepeatingInterval(interval)) {
          chrome.alarms.create(alarm.name, {
            delayInMinutes: interval
          });
          if (DEBUG_MODE) console.log(`Alarm reset: ${alarm.name} for ${interval} minutes`);
        } else if (interval) {
          console.error(`Invalid ${alarm.name} interval in storage: ${interval}. Must be between ${REPEATING_INTERVAL_MIN} and ${REPEATING_INTERVAL_MAX} minutes.`);
        }
      });
    }
  });
});

function updateAlarms(settings) {
  // Define alarm types to iterate through
  const alarmTypes = ['blink', 'water', 'up', 'stretch'];

  // Get existing alarms to compare
  chrome.alarms.getAll((existingAlarms) => {
    const existingAlarmNames = new Set(
      existingAlarms
        .filter(alarm => alarm.name !== 'oneTime')
        .map(alarm => alarm.name)
    );

    chrome.storage.local.get([ALARM_STATE_STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to read alarm state:', chrome.runtime.lastError);
      }

      const previousState = result?.[ALARM_STATE_STORAGE_KEY] ?? {};
      const nextState = {};

      // Update alarms based on settings
      alarmTypes.forEach(type => {
        const enabled = Boolean(settings[`${type}Enabled`]);
        const interval = Number(settings[`${type}Interval`]);

        nextState[type] = { enabled, interval };

        // If alarm is disabled or interval is 0, clear it
        if (!enabled || interval <= 0) {
          chrome.alarms.clear(type);
          if (DEBUG_MODE) console.log(`Cleared ${type} alarm (disabled or interval=0)`);
          return;
        }

        // Validate interval before creating or rescheduling alarm
        if (!isValidRepeatingInterval(interval)) {
          console.error(`Invalid ${type} interval: ${interval}. Must be between ${REPEATING_INTERVAL_MIN} and ${REPEATING_INTERVAL_MAX} minutes.`);
          chrome.alarms.clear(type);
          return;
        }

        // Create new alarm if missing
        if (!existingAlarmNames.has(type)) {
          chrome.alarms.create(type, { delayInMinutes: interval });
          if (DEBUG_MODE) console.log(`Created ${type} alarm: ${interval} minutes`);
          return;
        }

        // Reschedule only when alarm-related settings have changed.
        const previous = previousState[type];
        const shouldReschedule = previous && (
          Boolean(previous.enabled) !== enabled ||
          Number(previous.interval) !== interval
        );

        if (shouldReschedule) {
          chrome.alarms.clear(type, (wasCleared) => {
            if (wasCleared) {
              chrome.alarms.create(type, { delayInMinutes: interval });
              if (DEBUG_MODE) console.log(`Updated ${type} alarm: ${interval} minutes`);
            }
          });
        }
      });

      chrome.storage.local.set({ [ALARM_STATE_STORAGE_KEY]: nextState }, () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to save alarm state:', chrome.runtime.lastError);
        }
      });
    });
  });
}

// Expose selected helpers for unit tests without affecting extension runtime.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isValidAlarmInterval,
    isValidRepeatingInterval,
    updateAlarms,
    createNotification,
    processWaterLogQueue,
    handleWaterLogRetry,
    getIsMacOS,
    playNotificationSoundIfNeeded
  };
}
