# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Project Overview

**Recharge** is a Chrome Manifest V3 extension that provides customizable break reminders for healthy work habits. The extension uses a service worker-based architecture with no build process—files are edited directly and reloaded in the browser.

## Development Workflow

### Installation for Development
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked" and select the project directory
4. To reload after changes: Click the refresh icon on the extension card, or for background.js specifically, click the "Service worker" link to open DevTools and use the refresh button there

### Debugging
- **Background script (service worker)**: chrome://extensions/ → Find "Recharge" → Click "Service worker" link → Opens DevTools
- **Popup**: Right-click the popup → Inspect → Opens DevTools
- **Debug mode**: Set `DEBUG_MODE = true` in background.js (line 9) to enable console logging

### No Build Process
This is a vanilla JavaScript extension with no compilation, bundling, or dependencies. Edit files directly and reload the extension to test changes.

### Packaging for Chrome Web Store
Run `./build.sh` to create `dist/recharge.zip` containing only the files required for upload.

### Testing
- Install dependencies: `npm install`
- Unit + integration tests with coverage: `npm test`
- Manual release checklist: `docs/manual-test-cases.md`

## Architecture

### Component Structure
- **background.js** (273 lines): Service worker that manages alarms, notifications, and storage
- **popup.js/popup.html/popup.css** (490 lines): User interface for settings and timer controls
- **manifest.json**: Extension configuration with permissions for notifications, storage, and alarms

### Message Passing Pattern
The extension uses Chrome's message passing API for popup ↔ background communication:

**Popup → Background messages:**
- `updateAlarms` - Sent when settings change, includes updated settings object
- `createOneTimeTimer` - Sent to create countdown timer, includes `minutes` property

**Background → Popup messages:**
- `timerComplete` - Sent when one-time countdown timer finishes
- `waterLogged` - Sent when water log counter increments, includes `count` property

**Error handling**: Always check `chrome.runtime.lastError` after sending messages to popup, as the popup may be closed (see background.js:81-86).

### Storage Schema
All settings stored in `chrome.storage.sync`:
```javascript
{
  // Feature toggles
  blinkEnabled: boolean,
  waterEnabled: boolean,
  upEnabled: boolean,
  stretchEnabled: boolean,

  // Intervals (0-60 minutes)
  blinkInterval: number,
  waterInterval: number,
  upInterval: number,
  stretchInterval: number,

  // Sound toggle
  soundEnabled: boolean,

  // Water logging counter (resets daily)
  waterLogCount: number,
  waterLogDate: string  // Date string for daily reset check
}
```

### Alarm Management Pattern

Alarms are created with `delayInMinutes` (not `periodInMinutes`) to allow dynamic interval changes:

1. When an alarm fires, it checks the current interval from storage
2. Recreates itself with the updated interval
3. One-time timer (`oneTime`) does not auto-restart

Alarm names: `blink`, `water`, `up`, `stretch`, `oneTime`

The `updateAlarms()` function in background.js handles intelligent alarm updates—only recreates alarms when intervals actually change (see background.js:167-216).

### Notification System

**Standard notifications**: Simple notifications without buttons

**Water notifications** (special handling):
- Two buttons: "Log Water" (index 0) and "Skip" (index 1)
- Platform-specific `requireInteraction`: false on macOS, true on other platforms (macOS has limitations with persistent buttoned notifications)
- Unique notification ID format: `water_${timestamp}` for proper button click tracking
- Button clicks handled in `chrome.notifications.onButtonClicked` listener (background.js:61-71)
- Uses queue-based pattern to prevent race conditions when rapidly clicking "Log Water" (see Water Log Queue Pattern below)

Helper function `createNotification()` abstracts notification creation with consistent options (background.js:74-101). Custom properties like `isWater` are extracted before passing to Chrome API.

### Daily Counter Pattern

The water log counter uses a date-based reset pattern:
```javascript
const today = new Date().toDateString();
if (waterLogDate !== today) {
  waterLogCount = 0;
}
```
This pattern appears in both background.js (onInstalled) and popup.js (DOMContentLoaded) for display purposes.

### Water Log Queue Pattern

The water log increment uses a queue-based pattern to prevent race conditions from rapid button clicks or multiple stacked notifications:

**Queue structure** (background.js:11-13):
```javascript
let waterLogQueue = [];
let isProcessingWaterLogQueue = false;
```

**Processing flow** (background.js:118-182):
1. Button click pushes operation object with timestamp to queue
2. `processWaterLogQueue()` checks if already processing
3. Performs atomic read-modify-write on storage
4. Handles date-based reset if needed
5. Increments counter and saves to storage
6. Only removes from queue after successful write
7. Sends message to popup to update display
8. Recursively processes next operation in queue

**Key features**:
- Serialized processing prevents concurrent storage writes
- Each operation performs full atomic read-modify-write cycle
- Error handling for both read and write operations with retry
- Operations remain in queue until successful completion (no data loss)
- Popup notification only sent on successful increments

This pattern ensures accurate counter updates even with rapid successive clicks, addressing BUG-250115-001.

## Naming Conventions

- **Storage keys**: `{feature}Enabled`, `{feature}Interval` (e.g., `blinkEnabled`, `waterInterval`)
- **DOM IDs**: CamelCase matching storage keys (e.g., `blinkToggle`, `blinkInterval`)
- **Message actions**: camelCase verbs (e.g., `updateAlarms`, `createOneTimeTimer`)
- **Alarm names**: Simple lowercase (e.g., `blink`, `water`, `oneTime`)
- **Notification messages**: Defined in `NOTIFICATION_MESSAGES` constant at top of background.js

## Code Patterns

### Default Value Handling
Use nullish coalescing operator (`??`) for fallback values when reading from storage:
```javascript
blinkInterval: result.blinkInterval ?? 10
```

### Error Handling
- Always check `chrome.runtime.lastError` after callbacks
- Silent error handling for expected errors (e.g., popup not open when sending message)
- Console.error only for unexpected errors

### Notification ID Management
For notifications with buttons, use unique IDs with timestamps:
```javascript
const notificationId = isWater ? `water_${Date.now()}` : undefined;
```
This ensures each notification button click maps to the correct notification instance.

## Git Commit Conventions

Follow conventional commits format:
```
<type>(<scope>): <message>
```

Examples from recent commits:
- `fix(background): handle error when sending message to closed popup`
- `feat(water-log): add water log counter and notification buttons`
- `refactor(background): extract notification creation logic into helper function`

Types: `feat`, `fix`, `refactor`, `docs`, `chore`

## Important Implementation Details

### macOS Notification Limitation
macOS doesn't handle persistent notifications with buttons well, so `requireInteraction` is set to `false` on macOS but `true` on other platforms. Detection via navigator.userAgent (background.js:133).

### State Synchronization
- Popup reads from storage on load (DOMContentLoaded listener)
- Settings saved immediately on any input change (input event listeners)
- Background maintains alarms based on storage state
- Water count updates broadcast to popup via message passing

### CSS Custom Properties
Theme colors defined as CSS custom properties in popup.css for consistent theming:
```css
--primary-color: #4a90d9;
--text-color: #333;
--background-hover: #f5f5f5;
```
