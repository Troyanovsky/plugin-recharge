/**
 * offscreen.js - Offscreen audio playback for Recharge Chrome extension
 *
 * Plays a short synthesized "beep" using Web Audio APIs when the service worker
 * requests it. This avoids relying on platform-specific notification sounds.
 */

const DEBUG_MODE = false; // Temporarily set true when diagnosing sound playback.

const BEEP_DURATION_MS = 420;

const BEEP_FREQUENCY_BY_ALARM_HZ = {
  water: 660,
  oneTime: 880,
  default: 784
};

function debugLog(...args) {
  if (DEBUG_MODE) {
    // eslint-disable-next-line no-console
    console.log('[offscreen sound]', ...args);
  }
}

let sharedAudioContext = null;

async function getOrCreateAudioContext() {
  if (sharedAudioContext) {
    return sharedAudioContext;
  }

  const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextConstructor) {
    debugLog('AudioContext not available');
    throw new Error('AudioContext not available');
  }

  debugLog('Creating AudioContext');
  sharedAudioContext = new AudioContextConstructor();
  return sharedAudioContext;
}

async function ensureAudioContextRunning(audioContext) {
  debugLog('AudioContext state (pre):', audioContext.state);
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (error) {
      debugLog('AudioContext resume() threw:', error);
    }
  }
  debugLog('AudioContext state (post):', audioContext.state);
  if (audioContext.state !== 'running') {
    throw new Error(`AudioContext not running (state=${audioContext.state})`);
  }
}

/**
 * Plays a short beep via Web Audio.
 * Attempts to resume AudioContext (autoplay policies may start it suspended).
 * @param {string | undefined} alarmName
 * @returns {Promise<{state: string, frequency: number, durationMs: number}>}
 */
async function playBeep(alarmName) {
  const audioContext = await getOrCreateAudioContext();
  await ensureAudioContextRunning(audioContext);
  const frequency = BEEP_FREQUENCY_BY_ALARM_HZ[alarmName] ?? BEEP_FREQUENCY_BY_ALARM_HZ.default;
  debugLog('Beep frequency:', frequency, 'alarm:', alarmName);

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  try {
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    const now = audioContext.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.6, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (BEEP_DURATION_MS / 1000));

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(now + (BEEP_DURATION_MS / 1000));

    await new Promise((resolve) => {
      oscillator.onended = resolve;
    });
    debugLog('Beep finished');
  } finally {
    try { oscillator.disconnect(); } catch {}
    try { gain.disconnect(); } catch {}
  }

  return { state: audioContext.state, frequency, durationMs: BEEP_DURATION_MS };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'playNotificationSound') {
    return;
  }

  debugLog('Received playNotificationSound message', message);
  playBeep(message?.alarmName)
    .then((details) => {
      debugLog('Responding ok:true');
      sendResponse?.({ ok: true, ...details, alarmName: message?.alarmName });
    })
    .catch((error) => {
      console.error('Failed to play notification sound:', error);
      debugLog('Responding ok:false');
      sendResponse?.({ ok: false, alarmName: message?.alarmName, error: String(error?.message ?? error) });
    });

  // Keep the message channel open for the async response.
  return true;
});

// Notify the service worker that the offscreen document is initialized and
// ready to receive messages. This avoids races where createDocument resolves
// before scripts are executed.
chrome.runtime.sendMessage({ action: 'offscreenReady' }, () => {
  // Ignore delivery errors; the service worker may be starting up.
});
