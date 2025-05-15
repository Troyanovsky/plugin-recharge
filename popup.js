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
    startTimerBtn.disabled = true;
    
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

function saveSettings() {
  const settings = {
    blinkEnabled: document.getElementById('blinkToggle').checked,
    blinkInterval: parseInt(document.getElementById('blinkInterval').value),
    waterEnabled: document.getElementById('waterToggle').checked,
    waterInterval: parseInt(document.getElementById('waterInterval').value),
    upEnabled: document.getElementById('upToggle').checked,
    upInterval: parseInt(document.getElementById('upInterval').value),
    stretchEnabled: document.getElementById('stretchToggle').checked,
    stretchInterval: parseInt(document.getElementById('stretchInterval').value),
    soundEnabled: document.getElementById('soundToggle').checked
  };

  chrome.storage.sync.set(settings, () => {
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