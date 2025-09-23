export const TODOIST_COLORS = {
  "berry_red": "#b8255f",
  "red": "#db4035",
  "orange": "#ff9933",
  "yellow": "#fad000",
  "olive_green": "#afb83b",
  "lime_green": "#7ecc49",
  "green": "#299438",
  "mint_green": "#6accbc",
  "teal": "#158fad",
  "sky_blue": "#14aaf5",
  "light_blue": "#96c3eb",
  "blue": "#4073ff",
  "grape": "#884dff",
  "violet": "#af38eb",
  "lavender": "#eb96eb",
  "magenta": "#e05194",
  "salmon": "#ff8d85",
  "charcoal": "#808080",
  "grey": "#b8b8b8",
  "taupe": "#ccac93",
} as const

export function getProjectColor(color: string): string {
  return TODOIST_COLORS[color as keyof typeof TODOIST_COLORS] || "#808080"
}

export const PRIORITY_COLORS = {
  1: "#d1d5db", // gray-300
  2: "#3b82f6", // blue-500
  3: "#f97316", // orange-500
  4: "#ef4444", // red-500
} as const

export function getPriorityColor(priority: number): string {
  return PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] || "#d1d5db"
}