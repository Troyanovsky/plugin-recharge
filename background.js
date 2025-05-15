const NOTIFICATION_MESSAGES = {
  blink: "Time to blink your eyes! Look away from the screen for 20 seconds.",
  water: "Time to drink some water! Stay hydrated!",
  up: "Time to get up and walk around for a few minutes!",
  stretch: "Time to do some stretching exercises!",
  oneTime: "Your timer is up!"
};

const DEBUG_MODE = false;  // Set this to false to disable debug logging

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
    const today = new Date().toDateString();
    const defaultSettings = {
      blinkEnabled: result.blinkEnabled ?? false,
      blinkInterval: result.blinkInterval ?? 10,
      waterEnabled: result.waterEnabled ?? false,
      waterInterval: result.waterInterval ?? 30,
      upEnabled: result.upEnabled ?? false,
      upInterval: result.upInterval ?? 40,
      stretchEnabled: result.stretchEnabled ?? false,
      stretchInterval: result.stretchInterval ?? 35,
      soundEnabled: result.soundEnabled ?? true,
      waterLogCount: (result.waterLogDate === today) ? result.waterLogCount : 0,
      waterLogDate: today
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
  if (message.action === 'createOneTimeTimer') {
    chrome.alarms.create('oneTime', {
      delayInMinutes: message.minutes
    });
    if (DEBUG_MODE) console.log(`Created one-time timer for ${message.minutes} minutes`);
  }
});

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('water_')) {
    if (buttonIndex === 0) { // Log Water button clicked
      // Get current date and water log count
      chrome.storage.sync.get(['waterLogCount', 'waterLogDate'], (result) => {
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
          if (DEBUG_MODE) console.log(`Water logged! Count: ${waterLogCount}`);
          // Notify popup to update the counter display
          chrome.runtime.sendMessage({ action: 'waterLogged', count: waterLogCount });
        });
      });
    }
    // For both buttons, clear the notification
    chrome.notifications.clear(notificationId);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (DEBUG_MODE) console.log(`Alarm triggered: ${alarm.name}`);
  
  chrome.storage.sync.get(['soundEnabled'], (result) => {
    if (alarm.name === 'water') {
      // Create notification with buttons for water alarm
      const notificationId = `water_${Date.now()}`;
      
      // Detect if user is on macOS
      const isMacOS = /Mac|MacIntel/.test(navigator.userAgent);
      
      if (DEBUG_MODE) console.log(`Platform detected: ${isMacOS ? 'macOS' : 'other'}, setting requireInteraction to ${!isMacOS}`);
      
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Recharge',
        message: NOTIFICATION_MESSAGES[alarm.name],
        buttons: [
          { title: 'Log Water' },
          { title: 'Skip' }
        ],
        requireInteraction: !isMacOS, // Set to false on macOS, true on other platforms
        silent: !result.soundEnabled
      }, (createdId) => {
        if (chrome.runtime.lastError) {
          console.error('Notification error:', chrome.runtime.lastError);
        } else if (DEBUG_MODE) {
          console.log(`Water notification created with ID: ${createdId}`);
        }
      });
      if (DEBUG_MODE) console.log(`Water notification created with buttons, sound ${result.soundEnabled ? 'enabled' : 'disabled'}`);
    } else {
      // Regular notification for other alarms
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Recharge',
        message: NOTIFICATION_MESSAGES[alarm.name],
        silent: !result.soundEnabled
      });
      if (DEBUG_MODE) console.log(`Notification created for ${alarm.name}, sound ${result.soundEnabled ? 'enabled' : 'disabled'}`);
    }

    if (alarm.name === 'oneTime') {
      // Notify popup that timer is complete
      chrome.runtime.sendMessage({ action: 'timerComplete' });
    } else {
      // Restart repeating alarms as before
      chrome.storage.sync.get([`${alarm.name}Interval`], (result) => {
        if (result[`${alarm.name}Interval`]) {
          chrome.alarms.create(alarm.name, {
            delayInMinutes: result[`${alarm.name}Interval`]
          });
          if (DEBUG_MODE) console.log(`Alarm reset: ${alarm.name} for ${result[`${alarm.name}Interval`]} minutes`);
        }
      });
    }
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