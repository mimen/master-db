/**
 * Time of Day preferences for routines
 * Determines when during the day a task should be ready
 */

export const TimeOfDay = {
  Morning: "Morning",   // 7am
  Day: "Day",           // 11am
  Evening: "Evening",   // 3pm
  Night: "Night",       // 7pm
} as const;

export type TimeOfDayType = (typeof TimeOfDay)[keyof typeof TimeOfDay];

/**
 * Convert time of day to hour (24-hour format)
 * Used for setting specific times on ready dates
 */
export function getTimeOfDayHour(timeOfDay: TimeOfDayType): number {
  switch (timeOfDay) {
    case TimeOfDay.Morning:
      return 7;
    case TimeOfDay.Day:
      return 11;
    case TimeOfDay.Evening:
      return 15; // 3pm
    case TimeOfDay.Night:
      return 19; // 7pm
    default:
      const _exhaustive: never = timeOfDay;
      throw new Error(`Unknown time of day: ${_exhaustive}`);
  }
}

/**
 * Convert time of day to corresponding Todoist label
 * Labels are stored without @ prefix in Todoist API
 */
export function getTimeOfDayLabel(timeOfDay: TimeOfDayType): string {
  switch (timeOfDay) {
    case TimeOfDay.Morning:
      return "morning";
    case TimeOfDay.Day:
      return "day";
    case TimeOfDay.Evening:
      return "evening";
    case TimeOfDay.Night:
      return "night";
    default:
      const _exhaustive: never = timeOfDay;
      throw new Error(`Unknown time of day: ${_exhaustive}`);
  }
}

/**
 * Get display name for time of day
 */
export function getTimeOfDayDisplay(timeOfDay: TimeOfDayType): string {
  const hour = getTimeOfDayHour(timeOfDay);
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour > 12 ? hour - 12 : hour;
  return `${timeOfDay} (${displayHour}${period})`;
}
