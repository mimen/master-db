# Personal Master Database

A single-user Convex-based system that serves as a centralized data hub for all digital services, starting with Todoist integration.

## Overview

This system maintains real-time synchronization through webhooks with hourly periodic sync as backup, using a clear data flow: UI → Convex Action → Todoist API → Store in Convex → UI Update (immediate).

## Features

- **Real-time Sync**: Immediate updates via webhooks
- **Triple Redundancy**: API response storage, webhooks, and periodic sync
- **Comprehensive Data**: Tasks, projects, sections, labels, notes, and reminders
- **Idempotent Operations**: Sync version tracking prevents data conflicts
- **Production Ready**: Built for 99.9%+ reliability

## Documentation

- [Product Requirements Document](docs/PRD.md) - Detailed system design and architecture
- [Implementation Plan](docs/Implementation_Plan.md) - Step-by-step build guide
- [API Reference](docs/API_Reference.md) - Convex functions and queries
- [Development Guide](docs/Development_Guide.md) - Local setup and testing

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/mimen/master-db.git
   cd master-db
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Add your TODOIST_API_TOKEN
   ```

4. **Start development**
   ```bash
   npx convex dev
   ```

5. **Run initial sync**
   ```bash
   npx convex run todoist:initialSync:runInitialSync
   ```

## Project Structure

```
master-db/
├── convex/              # Backend functions and schema
│   ├── schema.ts        # Database schema
│   ├── todoist/         # Todoist integration
│   │   ├── actions.ts   # API operations
│   │   ├── mutations.ts # Database mutations
│   │   ├── queries.ts   # Data queries
│   │   └── webhook.ts   # Webhook handlers
│   └── http.ts          # HTTP routes
├── app/                 # Next.js frontend (future)
├── docs/                # Documentation
└── tests/               # Test suite
```

## Tech Stack

- **Backend**: Convex (real-time database, functions, cron jobs)
- **Language**: TypeScript
- **Runtime**: Bun
- **Frontend**: Next.js 14+ (planned)
- **UI**: shadcn/ui (planned)

## Development Status

Currently implementing Phase 1: Foundation & Initial Import

See [Implementation Plan](docs/Implementation_Plan.md) for detailed progress.

## License

Private repository - All rights reserved

## Author

Milad Emami ([@mimen](https://github.com/mimen))