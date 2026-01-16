# Recharge - Chrome Extension

A Chrome extension that helps you maintain healthy habits while working at your computer by providing customizable reminders for:

- 👀 Blink Breaks - Remember to rest your eyes by looking away from the screen
- 💧 Water Breaks - Stay hydrated with regular water reminders 
- 🚶 Movement Breaks - Get up and walk around periodically
- 🧘 Stretch Breaks - Take time to stretch and avoid muscle tension
- ⏲️ One-time Timer - Set custom countdown timers for focused work sessions

## Features

- Customizable intervals for each type of break (0-60 minutes)
- Enable/disable individual reminders as needed
- One-time countdown timer with visual feedback (1-120 minutes)
- Optional notification sounds
- Simple and clean interface
- Runs in the background while you work

## How It Works

1. Click the extension icon to open the settings popup
2. Toggle on the reminders you want to receive
3. Adjust the interval sliders to set your preferred timing
4. The extension will send desktop notifications at your specified intervals
5. Each notification includes a helpful prompt for the specific break type
6. Use the one-time timer for custom countdown sessions

## Installation

1. Download from the Chrome Web Store (coming soon)
2. Or install manually:
   - Clone this repository
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the extension directory

## Testing

- Install dependencies: `npm install`
- Unit + integration tests with coverage: `npm test`
- Manual release checklist: `docs/manual-test-cases.md`

## Support

- Report issues on [GitHub](https://github.com/Troyanovsky/plugin-recharge)
- Support development by [buying me a beer](https://www.buymeacoffee.com/troyanovsky)

Created by [Troy](https://github.com/Troyanovsky)

## Changelog

- V1.3 2025-01-16 - Bug fixes and code quality improvements: race condition fixes, error handling, input validation, timer state persistence, automated test coverage
- V1.2 2025-05-17 - Added water logging counter
- V1.1 2024-11-25 - Added one-time countdown timer feature
- V1.0 2024-11-03 - Initial release. Supports Blink, Water, Movement, and Stretch reminders.
