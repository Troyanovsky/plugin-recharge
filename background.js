const NOTIFICATION_MESSAGES = {
  blink: "Time to blink your eyes! Look away from the screen for 20 seconds.",
  water: "Time to drink some water! Stay hydrated!",
  up: "Time to get up and walk around for a few minutes!",
  stretch: "Time to do some stretching exercises!"
};

const DEBUG_MODE = true;  // Set this to false to disable debug logging

chrome.runtime.onInstalled.addListener(() => {
  if (DEBUG_MODE) console.log('Extension installed/updated');
  
  // Initialize default settings
  chrome.storage.sync.get([
    'blinkEnabled', 'blinkInterval',
    'waterEnabled', 'waterInterval',
    'upEnabled', 'upInterval',
    'stretchEnabled', 'stretchInterval',
    'soundEnabled'
  ], (result) => {
    const defaultSettings = {
      blinkEnabled: result.blinkEnabled ?? false,
      blinkInterval: result.blinkInterval ?? 20,
      waterEnabled: result.waterEnabled ?? false,
      waterInterval: result.waterInterval ?? 30,
      upEnabled: result.upEnabled ?? false,
      upInterval: result.upInterval ?? 45,
      stretchEnabled: result.stretchEnabled ?? false,
      stretchInterval: result.stretchInterval ?? 40,
      soundEnabled: result.soundEnabled ?? true
    };
    if (DEBUG_MODE) console.log('Default settings:', defaultSettings);
    
    chrome.storage.sync.set(defaultSettings);
    updateAlarms(defaultSettings);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateAlarms') {
    updateAlarms(message.settings);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (DEBUG_MODE) console.log(`Alarm triggered: ${alarm.name}`);
  
  chrome.storage.sync.get(['soundEnabled'], (result) => {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Recharge',
      message: NOTIFICATION_MESSAGES[alarm.name],
      silent: !result.soundEnabled
    });
    if (DEBUG_MODE) console.log(`Notification created for ${alarm.name}, sound ${result.soundEnabled ? 'enabled' : 'disabled'}`);

    // Restart the alarm
    chrome.storage.sync.get([`${alarm.name}Interval`], (result) => {
      if (result[`${alarm.name}Interval`]) {
        chrome.alarms.create(alarm.name, {
          delayInMinutes: result[`${alarm.name}Interval`]
        });
        if (DEBUG_MODE) console.log(`Alarm reset: ${alarm.name} for ${result[`${alarm.name}Interval`]} minutes`);
      }
    });
  });
});

function updateAlarms(settings) {
  // Clear all existing alarms
  chrome.alarms.clearAll();
  if (DEBUG_MODE) console.log('Cleared all existing alarms');

  // Create new alarms based on settings
  if (settings.blinkEnabled && settings.blinkInterval > 0) {
    chrome.alarms.create('blink', {
      delayInMinutes: settings.blinkInterval
    });
    if (DEBUG_MODE) console.log(`Created blink alarm: ${settings.blinkInterval} minutes`);
  }

  if (settings.waterEnabled && settings.waterInterval > 0) {
    chrome.alarms.create('water', {
      delayInMinutes: settings.waterInterval
    });
    if (DEBUG_MODE) console.log(`Created water alarm: ${settings.waterInterval} minutes`);
  }

  if (settings.upEnabled && settings.upInterval > 0) {
    chrome.alarms.create('up', {
      delayInMinutes: settings.upInterval
    });
    if (DEBUG_MODE) console.log(`Created up alarm: ${settings.upInterval} minutes`);
  }

  if (settings.stretchEnabled && settings.stretchInterval > 0) {
    chrome.alarms.create('stretch', {
      delayInMinutes: settings.stretchInterval
    });
    if (DEBUG_MODE) console.log(`Created stretch alarm: ${settings.stretchInterval} minutes`);
  }
} 