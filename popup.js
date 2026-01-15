// Validation constants for timer and interval values
const ONE_TIME_MIN = 1;
const ONE_TIME_MAX = 120;
const REPEATING_INTERVAL_MIN = 0;
const REPEATING_INTERVAL_MAX = 60;

document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get([
    'blinkEnabled', 'blinkInterval',
    'waterEnabled', 'waterInterval',
    'upEnabled', 'upInterval',
    'stretchEnabled', 'stretchInterval',
    'soundEnabled',
    'waterLogCount', 'waterLogDate'
  ], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to load settings:', chrome.runtime.lastError);
      return;
    }

    // Set toggle states
    document.getElementById('blinkToggle').checked = result.blinkEnabled ?? false;
    document.getElementById('waterToggle').checked = result.waterEnabled ?? false;
    document.getElementById('upToggle').checked = result.upEnabled ?? false;
    document.getElementById('stretchToggle').checked = result.stretchEnabled ?? false;
    document.getElementById('soundToggle').checked = result.soundEnabled ?? true;

    // Set slider values
    document.getElementById('blinkInterval').value = result.blinkInterval ?? 20;
    document.getElementById('waterInterval').value = result.waterInterval ?? 30;
    document.getElementById('upInterval').value = result.upInterval ?? 45;
    document.getElementById('stretchInterval').value = result.stretchInterval ?? 40;

    // Update display values
    updateDisplayValues();

    // Update water log counter
    const today = new Date().toDateString();
    const waterLogDate = result.waterLogDate || '';
    const waterLogCount = (waterLogDate === today) ? (result.waterLogCount || 0) : 0;

    updateWaterLogBadge(waterLogCount);
  });

  // Add event listeners for all inputs
  const inputs = document.querySelectorAll('input');
  inputs.forEach(input => {
    input.addEventListener('change', saveSettings);
  });

  // Add event listeners for range inputs to update display values
  const ranges = document.querySelectorAll('input[type="range"]');
  ranges.forEach(range => {
    range.addEventListener('input', updateDisplayValues);
  });

  // Add one-time timer functionality
  const startTimerBtn = document.getElementById('startTimerBtn');
  const oneTimeInterval = document.getElementById('oneTimeInterval');
  let countdownInterval;

  // Update one-time timer display
  oneTimeInterval.addEventListener('input', () => {
    document.getElementById('oneTimeValue').textContent = oneTimeInterval.value;
  });

  startTimerBtn.addEventListener('click', () => {
    const minutes = parseInt(oneTimeInterval.value);
    if (isNaN(minutes) || minutes < ONE_TIME_MIN || minutes > ONE_TIME_MAX) {
      alert(`Invalid timer value: ${minutes}. Must be between ${ONE_TIME_MIN} and ${ONE_TIME_MAX} minutes.`);
      return;
    }
    startTimerBtn.disabled = true;

    // Clear any existing interval to prevent memory leaks
    clearInterval(countdownInterval);

    // Calculate end time
    const endTime = Date.now() + minutes * 60 * 1000;

    // Update button text immediately
    updateButtonCountdown(endTime);

    // Set up countdown interval
    countdownInterval = setInterval(() => {
      updateButtonCountdown(endTime);
    }, 1000);

    // Send message to create one-time alarm
    chrome.runtime.sendMessage({
      action: 'createOneTimeTimer',
      minutes: minutes
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to create timer:', chrome.runtime.lastError);
        // Re-enable button and reset countdown on failure
        startTimerBtn.disabled = false;
        startTimerBtn.textContent = 'Start';
        clearInterval(countdownInterval);
      }
    });
  });

  // Listen for timer completion and water logged events
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'timerComplete') {
      startTimerBtn.disabled = false;
      startTimerBtn.textContent = 'Start';
      clearInterval(countdownInterval);
    } else if (message.action === 'waterLogged') {
      updateWaterLogBadge(message.count);
    }
  });

  // Clear interval when popup is closed
  window.addEventListener('unload', () => {
    clearInterval(countdownInterval);
  });
});

function updateDisplayValues() {
  document.getElementById('blinkValue').textContent = document.getElementById('blinkInterval').value;
  document.getElementById('waterValue').textContent = document.getElementById('waterInterval').value;
  document.getElementById('upValue').textContent = document.getElementById('upInterval').value;
  document.getElementById('stretchValue').textContent = document.getElementById('stretchInterval').value;
}

function updateWaterLogBadge(count) {
  const badge = document.getElementById('waterLogBadge');
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

/**
 * Validates if a value is a valid repeating alarm interval (0-60 minutes).
 * @param {number} value - The interval value to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
function isValidInterval(value) {
  return !isNaN(value) && value >= REPEATING_INTERVAL_MIN && value <= REPEATING_INTERVAL_MAX;
}

function saveSettings() {
  const blinkInterval = parseInt(document.getElementById('blinkInterval').value);
  const waterInterval = parseInt(document.getElementById('waterInterval').value);
  const upInterval = parseInt(document.getElementById('upInterval').value);
  const stretchInterval = parseInt(document.getElementById('stretchInterval').value);

  // Validate all interval values
  if (!isValidInterval(blinkInterval) || !isValidInterval(waterInterval) ||
      !isValidInterval(upInterval) || !isValidInterval(stretchInterval)) {
    alert(`Invalid interval value detected. All intervals must be between ${REPEATING_INTERVAL_MIN} and ${REPEATING_INTERVAL_MAX} minutes.`);
    return;
  }

  const settings = {
    blinkEnabled: document.getElementById('blinkToggle').checked,
    blinkInterval: blinkInterval,
    waterEnabled: document.getElementById('waterToggle').checked,
    waterInterval: waterInterval,
    upEnabled: document.getElementById('upToggle').checked,
    upInterval: upInterval,
    stretchEnabled: document.getElementById('stretchToggle').checked,
    stretchInterval: stretchInterval,
    soundEnabled: document.getElementById('soundToggle').checked
  };

  chrome.storage.sync.set(settings, () => {
    if (chrome.runtime.lastError) {
      console.error('Failed to save settings:', chrome.runtime.lastError);
      return;
    }
    chrome.runtime.sendMessage({ action: 'updateAlarms', settings });
  });
}

function updateButtonCountdown(endTime) {
  const remaining = Math.max(0, endTime - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  document.getElementById('startTimerBtn').textContent = formattedTime;
}