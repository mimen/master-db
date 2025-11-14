/**
 * Date formatting utilities for smart, context-aware date display.
 * Formats dates relative to today for nearby dates, absolute for distant dates.
 * Always includes time when present.
 */

export interface DueDateInfo {
  text: string
  isOverdue: boolean
  isToday: boolean
  isTomorrow: boolean
}

/**
 * Formats a date string (YYYY-MM-DD) or datetime string (ISO 8601) into a smart,
 * human-readable format.
 *
 * Examples:
 * - "Today" or "Today at 7:00 PM"
 * - "Tomorrow" or "Tomorrow at 3:30 PM"
 * - "Mon" or "Mon at 9:00 AM" (within 7 days)
 * - "Jan 15" or "Jan 15 at 2:00 PM" (beyond 7 days)
 * - "Yesterday" or "2 days overdue" (overdue dates)
 *
 * @param dateString - Date string (YYYY-MM-DD) or datetime (ISO 8601)
 * @returns Formatted date info with text, overdue status, and flags
 */
export function formatSmartDate(dateString: string | null | undefined): DueDateInfo {
  if (!dateString) {
    return { text: "", isOverdue: false, isToday: false, isTomorrow: false }
  }

  // Check if date string contains time (has 'T')
  const hasTime = dateString.includes("T")

  // Parse date in local timezone to avoid UTC midnight issue
  // Date-only strings like "2025-11-10" are parsed as UTC by default,
  // which shifts to previous day in timezones behind UTC (e.g., PST)
  // Solution: Append 'T00:00:00' to force local timezone parsing (only if no time exists)
  const normalizedDateString = hasTime ? dateString : dateString + "T00:00:00"
  const originalDate = new Date(normalizedDateString)

  // Create date for comparison (strip time)
  const date = new Date(originalDate)
  date.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const isOverdue = date < today
  const isToday = date.toDateString() === today.toDateString()
  const isTomorrow = date.toDateString() === tomorrow.toDateString()
  const isYesterday = date.toDateString() === yesterday.toDateString()

  let text = ""

  if (isToday) {
    text = "Today"
  } else if (isTomorrow) {
    text = "Tomorrow"
  } else if (isYesterday) {
    text = "Yesterday"
  } else if (isOverdue) {
    const daysOverdue = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    text = daysOverdue === 1 ? "Yesterday" : `${daysOverdue} days overdue`
  } else {
    // For dates within 7 days, show day of week
    const daysUntil = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    if (daysUntil < 7) {
      // Show day of week (Mon, Tue, Wed, etc.)
      text = date.toLocaleDateString("en-US", { weekday: "short" })
    } else {
      // Show absolute date
      text = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      })
    }
  }

  // Append time if date string contains time information
  if (hasTime) {
    const timeString = originalDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    text = `${text} at ${timeString}`
  }

  return { text, isOverdue, isToday, isTomorrow }
}

/**
 * Formats a deadline date (date-only, no time component).
 * Similar to formatSmartDate but optimized for deadline fields.
 *
 * @param dateString - Date string (YYYY-MM-DD)
 * @returns Formatted date info
 */
export function formatDeadline(dateString: string | null | undefined): DueDateInfo {
  // Deadlines are always date-only (no time), so we can use the same logic
  return formatSmartDate(dateString)
}

/**
 * Parses a natural language date string into an ISO date string.
 * This is a simplified version - for production, consider using a library
 * like chrono-node or Todoist's natural language API.
 *
 * Examples:
 * - "today" -> "2025-01-13"
 * - "tomorrow" -> "2025-01-14"
 * - "next week" -> "2025-01-20"
 *
 * @param input - Natural language date string
 * @returns ISO date string (YYYY-MM-DD) or null if unparseable
 */
export function parseNaturalLanguageDate(input: string): string | null {
  const normalized = input.toLowerCase().trim()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (normalized === "today" || normalized === "tod") {
    return formatDateToISO(today)
  }

  if (normalized === "tomorrow" || normalized === "tmr" || normalized === "tom") {
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return formatDateToISO(tomorrow)
  }

  if (normalized === "yesterday") {
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    return formatDateToISO(yesterday)
  }

  if (normalized === "next week") {
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)
    return formatDateToISO(nextWeek)
  }

  // Handle day names (mon, tue, etc.) - find next occurrence
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  const dayShortNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

  const dayIndex = dayNames.findIndex(d => d === normalized) !== -1
    ? dayNames.findIndex(d => d === normalized)
    : dayShortNames.findIndex(d => d === normalized)

  if (dayIndex !== -1) {
    const targetDay = new Date(today)
    const currentDay = targetDay.getDay()
    const daysUntil = (dayIndex - currentDay + 7) % 7 || 7 // If 0, use 7 (next week)
    targetDay.setDate(targetDay.getDate() + daysUntil)
    return formatDateToISO(targetDay)
  }

  return null
}

/**
 * Helper: Formats a Date object to ISO date string (YYYY-MM-DD)
 */
function formatDateToISO(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Helper: Formats a Date object to ISO datetime string
 */
export function formatDateTimeToISO(date: Date): string {
  return date.toISOString()
}
