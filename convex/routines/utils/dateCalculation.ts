/**
 * Date calculation utilities for routine task generation
 * All dates are UTC timestamps (milliseconds since epoch)
 */

import type { Doc } from "../../_generated/dataModel";
import { frequencyToDays, Frequency, isHighFrequency } from "../types/frequency";
import { getTimeOfDayHour, type TimeOfDayType } from "../types/timeOfDay";
import type { FrequencyType } from "../types/frequency";

/**
 * Calculate the next ready date for a routine
 * @param routine - The routine configuration
 * @param lastCompletedDate - Timestamp of last completion (optional)
 * @param wasRecentlyUndeferred - Whether routine was just undeferred
 * @returns Timestamp for next ready date
 */
export function calculateNextReadyDate(
  routine: Doc<"routines">,
  lastCompletedDate?: number,
  wasRecentlyUndeferred = false
): number {
  const now = Date.now();
  const frequencyDays = frequencyToDays(routine.frequency);

  // If recently undeferred, start from middle of frequency period
  if (wasRecentlyUndeferred && !lastCompletedDate) {
    const halfFrequency = Math.floor(frequencyDays / 2);
    return addDays(now, halfFrequency);
  }

  // If no completion history, start now
  if (!lastCompletedDate) {
    return now;
  }

  // Add frequency to last completion
  return addDays(lastCompletedDate, frequencyDays);
}

/**
 * Adjust date to ideal day of week for weekly+ frequencies
 * @param date - Starting date timestamp
 * @param idealDay - Preferred day (0=Sunday, 6=Saturday)
 * @param frequency - Routine frequency
 * @returns Adjusted timestamp
 */
export function adjustToIdealDay(
  date: number,
  idealDay: number,
  frequency: FrequencyType
): number {
  // Only apply to weekly or longer frequencies
  const frequencyDays = frequencyToDays(frequency);
  if (frequencyDays < 7) {
    return date;
  }

  const d = new Date(date);
  const currentDay = d.getDay();

  // Calculate days to add/subtract to reach ideal day
  let daysToAdd = idealDay - currentDay;

  // If ideal day is in the past this week, move to next week
  if (daysToAdd < 0) {
    daysToAdd += 7;
  }

  return addDays(date, daysToAdd);
}

/**
 * Calculate due date based on ready date and routine settings
 * @param readyDate - When task becomes actionable
 * @param timeOfDay - Optional time preference
 * @param frequency - Routine frequency
 * @returns Due date timestamp
 */
export function calculateDueDate(
  readyDate: number,
  timeOfDay: TimeOfDayType | undefined,
  frequency: FrequencyType
): number {
  // If time of day is set, due date is same as ready date (scheduled for that specific time)
  if (timeOfDay) {
    return readyDate;
  }

  // Otherwise, due at end of frequency period (minus 1 day)
  const frequencyDays = frequencyToDays(frequency);
  const dueDate = addDays(readyDate, Math.max(0, frequencyDays - 1));

  // Adjust weekend due dates
  return adjustWeekendDueDate(dueDate);
}

/**
 * Adjust weekend due dates: Saturday → Friday, Sunday → Monday
 * @param date - Due date timestamp
 * @returns Adjusted timestamp
 */
function adjustWeekendDueDate(date: number): number {
  const d = new Date(date);
  const day = d.getDay();

  if (day === 0) {
    // Sunday → Monday
    return addDays(date, 1);
  } else if (day === 6) {
    // Saturday → Friday
    return addDays(date, -1);
  }

  return date;
}

/**
 * Apply time of day to a date
 * @param date - Base date timestamp
 * @param timeOfDay - Time preference (Morning/Day/Evening/Night)
 * @returns Timestamp with time applied
 *
 * Note: Convex servers run in UTC. We need to adjust for user's timezone.
 * For PST (UTC-8), we add 8 hours to get the desired local time.
 * TODO: Make timezone configurable per user/routine
 */
export function applyTimeOfDay(
  date: number,
  timeOfDay: TimeOfDayType
): number {
  const d = new Date(date);
  const hour = getTimeOfDayHour(timeOfDay);

  // FIXME: Hardcoded for PST (UTC-8). Should be configurable per user.
  const timezoneOffset = 8; // Hours to add for PST
  const utcHour = hour + timezoneOffset;

  // Set to specific hour in UTC to achieve desired local time
  d.setUTCHours(utcHour, 0, 0, 0);

  return d.getTime();
}

/**
 * Get array of business day timestamps (skip weekends)
 * @param startDate - Starting date timestamp
 * @param numDays - Number of business days to get
 * @returns Array of timestamps
 */
export function getBusinessDaysAhead(
  startDate: number,
  numDays: number
): number[] {
  const dates: number[] = [];
  let current = startDate;
  let count = 0;

  while (count < numDays) {
    const d = new Date(current);
    const day = d.getDay();

    // Skip weekends
    if (day !== 0 && day !== 6) {
      dates.push(current);
      count++;
    }

    current = addDays(current, 1);
  }

  return dates;
}

/**
 * Check if we should generate a task for this routine
 * @param routine - Routine configuration
 * @param existingTaskDates - Set of existing ready dates
 * @param targetDate - Date we want to generate for
 * @returns True if should generate
 */
export function shouldGenerateTask(
  routine: Doc<"routines">,
  existingTaskDates: Set<string>,
  targetDate: number
): boolean {
  // Don't generate for deferred routines
  if (routine.defer) {
    return false;
  }

  // Don't generate if task already exists for this date (normalized to day)
  const dateKey = normalizeToDay(targetDate);
  if (existingTaskDates.has(dateKey)) {
    return false;
  }

  // Don't generate if more than 7 days in the future
  const sevenDaysFromNow = addDays(Date.now(), 7);
  if (targetDate > sevenDaysFromNow) {
    return false;
  }

  return true;
}

/**
 * Normalize timestamp to start of day (for comparison)
 * @param timestamp - Date timestamp
 * @returns ISO date string (YYYY-MM-DD)
 */
export function normalizeToDay(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toISOString().split("T")[0];
}

/**
 * Get Monday and Thursday of current/upcoming weeks
 * @param startDate - Starting date
 * @param count - How many M/Th pairs to generate
 * @returns Array of timestamps
 */
export function getTwiceAWeekDates(startDate: number, count: number): number[] {
  const dates: number[] = [];
  const d = new Date(startDate);

  // Move to next Monday
  const currentDay = d.getDay();
  const daysToMonday = currentDay === 0 ? 1 : currentDay === 1 ? 0 : 8 - currentDay;
  let monday = addDays(startDate, daysToMonday);

  for (let i = 0; i < count; i++) {
    // Add Monday
    dates.push(monday);

    // Add Thursday (3 days after Monday)
    const thursday = addDays(monday, 3);
    dates.push(thursday);

    // Move to next Monday (7 days)
    monday = addDays(monday, 7);

    // If we have enough dates, break
    if (dates.length >= count * 2) {
      break;
    }
  }

  return dates.slice(0, count * 2);
}

/**
 * Add days to a timestamp
 * @param timestamp - Starting timestamp
 * @param days - Days to add (can be negative)
 * @returns New timestamp
 */
export function addDays(timestamp: number, days: number): number {
  const d = new Date(timestamp);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/**
 * Add hours to a timestamp
 * @param timestamp - Starting timestamp
 * @param hours - Hours to add
 * @returns New timestamp
 */
export function addHours(timestamp: number, hours: number): number {
  return timestamp + hours * 60 * 60 * 1000;
}

/**
 * Check if a date is a weekend
 * @param timestamp - Date timestamp
 * @returns True if Saturday or Sunday
 */
export function isWeekend(timestamp: number): boolean {
  const day = new Date(timestamp).getDay();
  return day === 0 || day === 6;
}

/**
 * Get start of day (midnight) for a timestamp
 * @param timestamp - Date timestamp
 * @returns Timestamp at start of day
 */
export function getStartOfDay(timestamp: number): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
