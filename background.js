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
          chrome.runtime.sendMessage({ action: 'waterLogged', count: waterLogCount }, () => {
            // Check for error and ignore it - this happens when popup is not open
            if (chrome.runtime.lastError) {
              // Silently handle the error
              if (DEBUG_MODE) console.log('Popup not open, could not send water logged message');
            }
          });
        });
      });
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