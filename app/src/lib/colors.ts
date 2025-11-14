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

// Color options for project creation - ordered for visual appeal in grid
export const TODOIST_COLOR_OPTIONS = [
  { name: "berry_red", hex: "#b8255f", displayName: "Berry Red" },
  { name: "red", hex: "#db4035", displayName: "Red" },
  { name: "orange", hex: "#ff9933", displayName: "Orange" },
  { name: "yellow", hex: "#fad000", displayName: "Yellow" },
  { name: "olive_green", hex: "#afb83b", displayName: "Olive Green" },
  { name: "lime_green", hex: "#7ecc49", displayName: "Lime Green" },
  { name: "green", hex: "#299438", displayName: "Green" },
  { name: "mint_green", hex: "#6accbc", displayName: "Mint Green" },
  { name: "teal", hex: "#158fad", displayName: "Teal" },
  { name: "sky_blue", hex: "#14aaf5", displayName: "Sky Blue" },
  { name: "light_blue", hex: "#96c3eb", displayName: "Light Blue" },
  { name: "blue", hex: "#4073ff", displayName: "Blue" },
  { name: "grape", hex: "#884dff", displayName: "Grape" },
  { name: "violet", hex: "#af38eb", displayName: "Violet" },
  { name: "lavender", hex: "#eb96eb", displayName: "Lavender" },
  { name: "magenta", hex: "#e05194", displayName: "Magenta" },
  { name: "salmon", hex: "#ff8d85", displayName: "Salmon" },
  { name: "charcoal", hex: "#808080", displayName: "Charcoal" },
  { name: "grey", hex: "#b8b8b8", displayName: "Grey" },
  { name: "taupe", hex: "#ccac93", displayName: "Taupe" },
] as const

export function getProjectColor(color: string): string {
  return TODOIST_COLORS[color as keyof typeof TODOIST_COLORS] || "#808080"
}

export const PRIORITY_COLORS = {
  1: "#d1d5db", // gray-300
  2: "#3b82f6", // blue-500
  3: "#f97316", // orange-500
  4: "#ef4444", // red-500
} as const