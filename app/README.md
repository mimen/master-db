# Todoist Processor Frontend

A modern React frontend for the Todoist task processor built with:

- **Vite** - Fast build tool
- **React 18** - UI library with TypeScript
- **Convex** - Real-time backend integration
- **shadcn/ui** - Modern component library
- **Tailwind CSS** - Utility-first styling
- **Lucide React** - Icon library

## Setup Complete ✅

The following foundational elements are now configured:

### 1. Project Structure
```
app/
├── src/
│   ├── components/
│   │   ├── layout/Layout.tsx          # Main layout wrapper
│   │   ├── ui/                        # shadcn/ui components
│   │   ├── views/                     # Future view components
│   │   ├── overlays/                  # Future overlay components
│   │   └── shared/                    # Future shared components
│   ├── hooks/                         # Future custom hooks
│   ├── lib/
│   │   ├── utils.ts                   # shadcn utilities
│   │   └── colors.ts                  # Todoist color definitions
│   ├── convex/
│   │   └── _generated/                # Convex types (auto-synced)
│   ├── App.tsx                        # Main app with ConvexProvider
│   └── main.tsx                       # App entry point
├── components.json                    # shadcn/ui configuration
├── tailwind.config.js                # Tailwind configuration
└── .env                              # Environment variables
```

### 2. Core Components Installed
- ✅ **Button, Card, Dialog** - Basic UI components
- ✅ **Checkbox, Popover, Command** - Interactive components
- ✅ **Layout** - Main app wrapper with header
- ✅ **TaskProcessor** - Basic component showing Convex connection

### 3. Convex Integration
- ✅ Connected to existing Convex backend
- ✅ Environment variables configured
- ✅ Generated types copied and accessible
- ✅ Basic queries working (sync status, active items)

### 4. Styling System
- ✅ Tailwind CSS 4.x configured
- ✅ shadcn/ui theme system with CSS variables
- ✅ Todoist brand colors defined
- ✅ Path aliases configured (@/ for src/)

## Development Commands

```bash
# Start development server
bun run dev

# Run on specific port
bun run dev --port 3000

# Build for production (when PostCSS issues are resolved)
bun run build

# Preview production build
bun run preview

# Lint code
bun run lint
```

## Current Status

The frontend is ready for feature development! You can:

1. **Start the dev server**: `bun run dev` 
2. **View the app**: Open `http://localhost:3000`
3. **See real data**: The app connects to your Convex backend and displays:
   - Sync status
   - Task counts
   - Sample active tasks

## Next Steps

Based on the [UI Component Breakdown](../docs/complete-ui-component-breakdown.md), implement:

1. **Processing View** - Card-based task processing interface
2. **List View** - Bulk task management interface  
3. **Overlay System** - Project/label/priority selectors
4. **Keyboard Shortcuts** - Efficient task navigation
5. **Queue Management** - Smart task ordering and progress

All the foundational work is complete - now you can focus on building the actual UX!

## Architecture Notes

- **Data Flow**: All data comes from Convex queries (real-time)
- **State Management**: React state for UI, Convex for data
- **Components**: shadcn/ui provides accessible, customizable base components
- **Styling**: Tailwind for utility classes, CSS variables for theming
- **Types**: Full end-to-end TypeScript support via Convex codegen
