/**
 * constants.js - Shared constants for Recharge Chrome Extension
 *
 * This file provides a single source of truth for all slider constraints,
 * default values, and validation limits used across the extension.
 */

// Validation limits for interval sliders
export const ONE_TIME_MIN = 1;
export const ONE_TIME_MAX = 120;
export const REPEATING_INTERVAL_MIN = 0;
export const REPEATING_INTERVAL_MAX = 60;

// Default values for interval sliders (in minutes)
export const DEFAULT_BLINK_INTERVAL = 20;
export const DEFAULT_WATER_INTERVAL = 30;
export const DEFAULT_UP_INTERVAL = 45;
export const DEFAULT_STRETCH_INTERVAL = 40;

// Default values for feature toggles
export const DEFAULT_SOUND_ENABLED = true;
export const DEFAULT_BLINK_ENABLED = false;
export const DEFAULT_WATER_ENABLED = false;
export const DEFAULT_UP_ENABLED = false;
export const DEFAULT_STRETCH_ENABLED = false;
