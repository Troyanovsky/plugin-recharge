---
title: Manual Test Cases
purpose: Release verification checklist for the Recharge Chrome extension
---

# Manual Test Cases (Release Checklist)

This document lists the manual checks to run before submitting a new version to the Chrome Web Store.

## Test Setup

- Chrome stable (and optionally Chrome Beta) on:
  - macOS (notification button behavior differs)
  - One additional platform (Windows or Linux) if possible
- Load unpacked extension from the repository root via `chrome://extensions/` (Developer mode on).
- Open Service Worker DevTools: `chrome://extensions/` → Recharge → `Service worker`.
- Ensure notifications are allowed for Chrome in OS settings.

## Smoke: Install / Update

1. Install the extension (fresh profile if possible).
2. Open the popup.
3. Confirm no console errors in:
   - Popup DevTools (right-click popup → Inspect)
   - Service Worker DevTools

## Settings: Defaults and Persistence

1. On first install, verify expected defaults:
   - All reminder toggles off
   - Sound toggle on
   - Sliders show default values (Blink 20, Water 30, Movement 45, Stretch 40)
2. Change each toggle and slider, close the popup, reopen it.
3. Verify all changes persist.

## Input Validation (Sliders)

1. Set a repeating interval slider to `0` with toggle enabled.
   - Expected: no repeating alarm fires for that reminder.
2. Set each repeating interval slider to `1` and `60`.
   - Expected: value displays correctly and reminders work.
3. One-time timer slider:
   - Verify minimum is `1` and maximum is `120`.

## Repeating Reminders

Run at least one reminder end-to-end with a short interval (e.g., 1–2 minutes).

1. Enable Blink and set interval to `1`.
2. Wait for a notification.
3. After the notification fires, wait another interval.
   - Expected: the reminder repeats (alarm reschedules itself).
4. Disable Blink.
   - Expected: no further notifications for Blink.

Repeat for at least one additional reminder (Water recommended due to special behavior).

## Water Reminder: Buttons and Counter

1. Enable Water and set interval to `1`.
2. When the Water notification appears:
   - Click `Log Water`.
   - Expected: `waterLogBadge` increments by 1 (if popup is open it should update live; otherwise verify on next popup open).
3. Click `Log Water` rapidly multiple times (or across multiple stacked notifications if supported).
   - Expected: the counter increments accurately without skipping or duplicating.
4. Click `Skip`.
   - Expected: notification clears and counter does not increment.

## Daily Reset (Water Counter)

1. Note the current `waterLogBadge` value.
2. In Service Worker DevTools, inspect `chrome.storage.sync` values:
   - `waterLogCount`
   - `waterLogDate`
3. Simulate a day change:
   - Set `waterLogDate` to a previous date via DevTools and reload the popup.
   - Expected: badge resets to 0.

## Sound Toggle

1. With Sound enabled, trigger a reminder notification.
2. Disable Sound, trigger again.
3. Expected: notification sound behavior changes accordingly (platform-dependent; verify at least that setting persists and notifications still appear).

## One-time Timer

1. Set one-time timer to `1` minute and press `Start`.
   - Expected: button disables and shows a countdown.
2. Close the popup while the countdown runs.
3. Wait for timer completion.
   - Expected: a notification appears (“Your timer is up!”).
4. Reopen the popup.
   - Expected: `Start` is available and the UI is responsive (no stuck disabled state).

## Alarm Update Behavior (No Unintended Resets)

This checks that changing non-alarm settings does not reset existing reminder schedules.

1. Enable Blink at `5` minutes.
2. Wait ~1 minute.
3. Toggle Sound on/off.
4. Expected: Blink schedule continues and is not restarted from the moment of the Sound toggle (approximate; verify no immediate “reset” behavior).

## Packaging Sanity (Web Store Zip)

1. Run `./build.sh`.
2. Verify `dist/recharge.zip` exists and contains only expected files:
   - `manifest.json`, `background.js`, `popup.*`, `constants.js`, `README.md`, `icons/`
3. Load unpacked from the staged contents (optional) and re-run Smoke checks.

