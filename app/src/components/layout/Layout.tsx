import { type ReactNode } from "react"

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold">Todoist Processor</h1>
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}