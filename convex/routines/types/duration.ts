/**
 * Duration types for routines
 * Represents expected time to complete a routine task
 */

export const Duration = {
  FiveMin: "5min",
  FifteenMin: "15min",
  ThirtyMin: "30min",
  FortyFiveMin: "45min",
  OneHour: "1hr",
  TwoHours: "2hr",
  ThreeHours: "3hr",
  FourHours: "4hr",
} as const;

export type DurationType = (typeof Duration)[keyof typeof Duration];

/**
 * Convert duration to hours (decimal)
 * Used for time tracking and planning
 */
export function durationToHours(duration: DurationType): number {
  switch (duration) {
    case Duration.FiveMin:
      return 0.083; // 5/60
    case Duration.FifteenMin:
      return 0.25; // 15/60
    case Duration.ThirtyMin:
      return 0.5; // 30/60
    case Duration.FortyFiveMin:
      return 0.75; // 45/60
    case Duration.OneHour:
      return 1;
    case Duration.TwoHours:
      return 2;
    case Duration.ThreeHours:
      return 3;
    case Duration.FourHours:
      return 4;
    default:
      const _exhaustive: never = duration;
      throw new Error(`Unknown duration: ${_exhaustive}`);
  }
}

/**
 * Convert duration to minutes
 * Used for Todoist API duration field
 */
export function durationToMinutes(duration: DurationType): number {
  return durationToHours(duration) * 60;
}

/**
 * Get display name for duration
 */
export function getDurationDisplay(duration: DurationType): string {
  return duration;
}
