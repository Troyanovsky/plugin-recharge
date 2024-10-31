document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get([
    'blinkEnabled', 'blinkInterval',
    'waterEnabled', 'waterInterval',
    'upEnabled', 'upInterval',
    'stretchEnabled', 'stretchInterval',
    'soundEnabled'
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
});

function updateDisplayValues() {
  document.getElementById('blinkValue').textContent = document.getElementById('blinkInterval').value;
  document.getElementById('waterValue').textContent = document.getElementById('waterInterval').value;
  document.getElementById('upValue').textContent = document.getElementById('upInterval').value;
  document.getElementById('stretchValue').textContent = document.getElementById('stretchInterval').value;
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