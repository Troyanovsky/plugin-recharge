/**
 * background.js - Service Worker for Recharge Chrome Extension
 *
 * Responsibilities:
 * - Manages chrome.alarms for periodic break reminders (blink, water, up, stretch)
 * - Creates and handles chrome.notifications with optional buttons
 * - Persists settings via chrome.storage.sync
 * - Processes water log increment requests with queue-based serialization
 *
 * Key Patterns:
 * - Alarms are recreated with updated intervals on each trigger (not periodic)
 * - Water notifications use unique IDs with timestamps for button tracking
 * - Water log counter uses a serialization queue to prevent race conditions
 */

const NOTIFICATION_MESSAGES = {
  blink: "Time to blink your eyes! Look away from the screen for 20 seconds.",
  water: "Time to drink some water! Stay hydrated!",
  up: "Time to get up and walk around for a few minutes!",
  stretch: "Time to do some stretching exercises!",
  oneTime: "Your timer is up!"
};

const DEBUG_MODE = false;  // Set this to false to disable debug logging

// Water log increment queue to prevent race conditions from rapid clicks
let waterLogQueue = [];
let isProcessingWaterLogQueue = false;
const WATER_LOG_MAX_RETRIES = 5;
const WATER_LOG_RETRY_DELAY_MS = 500;

// Validation constants for timer and interval values
const ONE_TIME_MIN = 1;
const ONE_TIME_MAX = 120;
const REPEATING_INTERVAL_MIN = 0;
const REPEATING_INTERVAL_MAX = 60;

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
      blinkEnabled: result.blinkEnabled ?? false,
      blinkInterval: result.blinkInterval ?? 20,
      waterEnabled: result.waterEnabled ?? false,
      waterInterval: result.waterInterval ?? 30,
      upEnabled: result.upEnabled ?? false,
      upInterval: result.upInterval ?? 45,
      stretchEnabled: result.stretchEnabled ?? false,
      stretchInterval: result.stretchInterval ?? 40,
      soundEnabled: result.soundEnabled ?? true,
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
  if (message.action === 'updateAlarms') {
    updateAlarms(message.settings);
  }
  if (message.action === 'createOneTimeTimer') {
    const minutes = message.minutes;
    if (isValidAlarmInterval(minutes)) {
      chrome.alarms.create('oneTime', {
        delayInMinutes: minutes
      });
      if (DEBUG_MODE) console.log(`Created one-time timer for ${minutes} minutes`);
    } else {
      console.error(`Invalid one-time timer value: ${minutes}. Must be between ${ONE_TIME_MIN} and ${ONE_TIME_MAX} minutes.`);
    }
  }
});

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
    silent: !soundEnabled
  };
  
  // Create a clean copy of options without any custom properties
  const { isWater, ...cleanOptions } = options;
  const notificationOptions = { ...baseOptions, ...cleanOptions };
  const notificationId = isWater ? `water_${Date.now()}` : undefined;
  
  chrome.notifications.create(notificationId, notificationOptions, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error('Notification error:', chrome.runtime.lastError);
    } else if (DEBUG_MODE && createdId) {
      console.log(`Notification created with ID: ${createdId}`);
    }
  });
  
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
    if (alarm.name === 'water') {
      // Create notification with buttons for water alarm
      // Detect if user is on macOS
      const isMacOS = /Mac|MacIntel/.test(navigator.userAgent);
      
      if (DEBUG_MODE) console.log(`Platform detected: ${isMacOS ? 'macOS' : 'other'}, setting requireInteraction to ${!isMacOS}`);
      
      createNotification(alarm.name, result.soundEnabled, {
        buttons: [
          { title: 'Log Water' },
          { title: 'Skip' }
        ],
        requireInteraction: !isMacOS, // Set to false on macOS, true on other platforms
        isWater: true // This is a custom property that will be extracted before creating the notification
      });
    } else {
      // Regular notification for other alarms
      createNotification(alarm.name, result.soundEnabled);
    }

    if (alarm.name === 'oneTime') {
      // Notify popup that timer is complete
      chrome.runtime.sendMessage({ action: 'timerComplete' });
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
    // Create a map of existing alarms for easy lookup
    const existingAlarmsMap = {};
    existingAlarms.forEach(alarm => {
      // Only map the repeating alarms (not oneTime)
      if (alarm.name !== 'oneTime') {
        existingAlarmsMap[alarm.name] = alarm;
      }
    });

    // Update alarms based on settings
    alarmTypes.forEach(type => {
      const isEnabled = settings[`${type}Enabled`];
      const interval = settings[`${type}Interval`];

      // Validate interval before creating alarm
      if (isEnabled && !isValidRepeatingInterval(interval)) {
        console.error(`Invalid ${type} interval: ${interval}. Must be between ${REPEATING_INTERVAL_MIN} and ${REPEATING_INTERVAL_MAX} minutes.`);
        return;
      }

      if (isEnabled && interval > 0) {
        // Check if this alarm already exists
        const existingAlarm = existingAlarmsMap[type];

        // If alarm doesn't exist or settings have changed, create/update it
        if (!existingAlarm) {
          // Create new alarm
          chrome.alarms.create(type, {
            delayInMinutes: interval
          });
          if (DEBUG_MODE) console.log(`Created ${type} alarm: ${interval} minutes`);
        } else {
          // Only clear and recreate if the interval has changed
          chrome.alarms.clear(type, (wasCleared) => {
            if (wasCleared) {
              chrome.alarms.create(type, {
                delayInMinutes: interval
              });
              if (DEBUG_MODE) console.log(`Updated ${type} alarm: ${interval} minutes`);
            }
          });
        }
      } else {
        // If alarm is disabled or interval is 0, clear it
        chrome.alarms.clear(type);
        if (DEBUG_MODE) console.log(`Cleared ${type} alarm (disabled or interval=0)`);
      }
    });
  });
}
