import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <IconSun className="h-5 w-5" />
      </Button>
    )
  }

  const cycleTheme = () => {
    if (theme === "light") {
      setTheme("dark")
    } else if (theme === "dark") {
      setTheme("system")
    } else {
      setTheme("light")
    }
  }

  const getIcon = () => {
    if (theme === "dark") {
      return <IconMoon className="h-5 w-5" />
    } else if (theme === "system") {
      return (
        <div className="relative h-5 w-5">
          <IconDeviceDesktop className="h-5 w-5" />
          <div className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background border border-border" style={{ padding: '1px' }}>
            {resolvedTheme === "dark" ? (
              <IconMoon style={{ width: '9.5px', height: '9.5px' }} strokeWidth={1.5} />
            ) : (
              <IconSun style={{ width: '9.5px', height: '9.5px' }} strokeWidth={1.5} />
            )}
          </div>
        </div>
      )
    } else {
      return <IconSun className="h-5 w-5" />
    }
  }

  const getNextTheme = () => {
    if (theme === "light") return "dark"
    if (theme === "dark") return "system"
    return "light"
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycleTheme}
      title={`Switch to ${getNextTheme()} mode`}
    >
      {getIcon()}
    </Button>
  )
}
