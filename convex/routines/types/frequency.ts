/**
 * Frequency types for routines
 * Defines how often a routine should generate tasks
 */

export const Frequency = {
  Daily: "Daily",
  TwiceAWeek: "Twice a Week",
  Weekly: "Weekly",
  EveryOtherWeek: "Every Other Week",
  Monthly: "Monthly",
  EveryOtherMonth: "Every Other Month",
  Quarterly: "Quarterly",
  TwiceAYear: "Twice a Year",
  Yearly: "Yearly",
  EveryOtherYear: "Every Other Year",
} as const;

export type FrequencyType = (typeof Frequency)[keyof typeof Frequency];

/**
 * Convert frequency to approximate number of days
 * Used for calculating next ready date and due dates
 */
export function frequencyToDays(frequency: FrequencyType): number {
  switch (frequency) {
    case Frequency.Daily:
      return 1;
    case Frequency.TwiceAWeek:
      return 3; // Average between 3-4 days
    case Frequency.Weekly:
      return 7;
    case Frequency.EveryOtherWeek:
      return 14;
    case Frequency.Monthly:
      return 30;
    case Frequency.EveryOtherMonth:
      return 60;
    case Frequency.Quarterly:
      return 90;
    case Frequency.TwiceAYear:
      return 182;
    case Frequency.Yearly:
      return 365;
    case Frequency.EveryOtherYear:
      return 730;
    default:
      // Type guard ensures this never happens, but TypeScript requires it
      const _exhaustive: never = frequency;
      throw new Error(`Unknown frequency: ${_exhaustive}`);
  }
}

/**
 * Check if frequency is high enough to warrant multiple tasks ahead
 * Daily and TwiceAWeek generate multiple tasks; others generate 1-2
 */
export function isHighFrequency(frequency: FrequencyType): boolean {
  return (
    frequency === Frequency.Daily || frequency === Frequency.TwiceAWeek
  );
}
