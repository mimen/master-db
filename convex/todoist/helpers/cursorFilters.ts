/**
 * Shared filter predicates for optimistic cursor updates
 *
 * These pure functions work in both server (Convex) and client (React) contexts.
 * They use structural typing to accept minimal entity shapes needed for filtering.
 *
 * Purpose: Re-evaluate entity visibility after optimistic updates to determine
 * if cursor should move to next item.
 */

/**
 * Project filter predicate
 *
 * Checks if entity belongs to specified project
 */
export function matchesProjectFilter(
  entity: { project_id: string },
  projectId: string
): boolean {
  return entity.project_id === projectId
}

/**
 * Priority filter predicate
 *
 * Checks if entity has specified priority level
 * Note: Todoist API priorities are inverted from UI (4=P1, 3=P2, 2=P3, 1=P4)
 */
export function matchesPriorityFilter(
  entity: { priority: number },
  priority: number
): boolean {
  return entity.priority === priority
}

/**
 * Label filter predicate
 *
 * Checks if entity has specified label
 */
export function matchesLabelFilter(
  entity: { labels: string[] },
  label: string
): boolean {
  return entity.labels.includes(label)
}

/**
 * Today filter predicate
 *
 * Checks if entity is due today in user's local timezone
 *
 * @param entity Entity with due date info
 * @param timezoneOffsetMinutes Minutes to ADD to UTC to get local time (e.g., PST is -480)
 */
export function matchesTodayFilter(
  entity: { due?: { date: string } | null },
  timezoneOffsetMinutes: number
): boolean {
  if (!entity.due?.date) return false

  const dueDate = entity.due.date

  // Get current time in user's timezone
  const offsetMs = timezoneOffsetMinutes * 60 * 1000
  const nowUTC = Date.now()
  const nowLocal = new Date(nowUTC + offsetMs)

  // Get today's date string in user's local timezone (YYYY-MM-DD)
  const year = nowLocal.getUTCFullYear()
  const month = String(nowLocal.getUTCMonth() + 1).padStart(2, '0')
  const day = String(nowLocal.getUTCDate()).padStart(2, '0')
  const todayLocalDate = `${year}-${month}-${day}`

  if (dueDate.includes('T')) {
    // For datetime strings, compare in UTC
    const todayLocal = new Date(Date.UTC(year, nowLocal.getUTCMonth(), nowLocal.getUTCDate(), 0, 0, 0, 0))
    const endOfTodayLocal = new Date(Date.UTC(year, nowLocal.getUTCMonth(), nowLocal.getUTCDate(), 23, 59, 59, 999))

    // Convert back to actual UTC for datetime comparisons
    const todayUTC = new Date(todayLocal.getTime() - offsetMs)
    const endOfTodayUTC = new Date(endOfTodayLocal.getTime() - offsetMs)

    const dueDateObj = new Date(dueDate)
    return dueDateObj >= todayUTC && dueDateObj <= endOfTodayUTC
  } else {
    // For date-only strings, compare with local date
    return dueDate === todayLocalDate
  }
}

/**
 * Next 7 days filter predicate
 *
 * Checks if entity is due within next 7 days (excluding today) in user's local timezone
 *
 * @param entity Entity with due date info
 * @param timezoneOffsetMinutes Minutes to ADD to UTC to get local time (e.g., PST is -480)
 */
export function matchesNext7DaysFilter(
  entity: { due?: { date: string } | null },
  timezoneOffsetMinutes: number
): boolean {
  if (!entity.due?.date) return false

  const dueDate = entity.due.date

  // Get current time in user's timezone
  const offsetMs = timezoneOffsetMinutes * 60 * 1000
  const nowUTC = Date.now()
  const nowLocal = new Date(nowUTC + offsetMs)

  // Get today's date string in user's local timezone (YYYY-MM-DD)
  const year = nowLocal.getUTCFullYear()
  const month = String(nowLocal.getUTCMonth() + 1).padStart(2, '0')
  const day = String(nowLocal.getUTCDate()).padStart(2, '0')
  const todayLocalDate = `${year}-${month}-${day}`

  // Calculate 7 days from today in user's timezone
  const next7DaysLocal = new Date(nowLocal)
  next7DaysLocal.setUTCDate(next7DaysLocal.getUTCDate() + 7)
  const next7Year = next7DaysLocal.getUTCFullYear()
  const next7Month = String(next7DaysLocal.getUTCMonth() + 1).padStart(2, '0')
  const next7Day = String(next7DaysLocal.getUTCDate()).padStart(2, '0')
  const next7DaysLocalDate = `${next7Year}-${next7Month}-${next7Day}`

  // Extract date-only part for consistent comparison
  const dateOnly = dueDate.includes('T') ? dueDate.split('T')[0] : dueDate

  // Upcoming means tomorrow through next 7 days (excluding today)
  return dateOnly > todayLocalDate && dateOnly <= next7DaysLocalDate
}
