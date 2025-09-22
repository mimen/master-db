# Development Guide

## Prerequisites

- Node.js 18+ or Bun
- Todoist account with API access
- ngrok (for webhook testing)

## Initial Setup

### 1. Get Todoist API Token

1. Go to [Todoist Settings](https://todoist.com/app/settings/integrations/developer)
2. Scroll to "API token"
3. Copy your personal API token

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your API token:
```env
TODOIST_API_TOKEN=your_actual_token_here
```

### 3. Install Dependencies

Using Bun (recommended):
```bash
bun install
```

Or npm:
```bash
npm install
```

## Development Workflow

### Starting the Dev Server

```bash
npx convex dev
```

This will:
- Start local Convex backend
- Watch for file changes
- Provide real-time logs
- Open dashboard at http://localhost:3001

### Running Initial Sync

After starting the dev server, run:
```bash
npx convex run todoist:initialSync:runInitialSync
```

This imports all your Todoist data into Convex.

### Testing Webhooks Locally

1. Start ngrok:
   ```bash
   ngrok http 8000
   ```

2. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

3. Configure webhook in Todoist:
   - Go to [Todoist App Console](https://developer.todoist.com/app_console)
   - Add webhook URL: `https://abc123.ngrok.io/todoist/webhook`

### Common Commands

```bash
# View all tasks
npx convex run todoist:queries:getActiveTasks

# Create a test task
npx convex run todoist:actions:createTask '{"content": "Test task"}'

# Check sync status
npx convex run todoist:queries:getSyncHealth

# Force incremental sync
npx convex run todoist:actions:performIncrementalSync
```

## Database Management

### Viewing Data

1. Open Convex Dashboard: http://localhost:3001
2. Navigate to "Data" tab
3. Browse tables: `todoist_tasks`, `todoist_projects`, etc.

### Resetting Database

```bash
# Clear all data (development only)
npx convex run --clear
```

### Checking Sync State

```sql
-- In Convex dashboard, run this query
db.sync_state.filter(q => q.eq(q.field("service"), "todoist")).first()
```

## Debugging

### Enable Verbose Logging

```typescript
// In any action/mutation
console.log("Sync started", { 
  timestamp: new Date().toISOString(),
  syncToken: syncState.last_sync_token 
});
```

### Common Issues

**Issue**: "TODOIST_API_TOKEN not configured"
- **Solution**: Ensure `.env.local` exists and contains valid token

**Issue**: Webhook signature verification fails
- **Solution**: Check `TODOIST_WEBHOOK_SECRET` matches Todoist settings

**Issue**: Sync token invalid
- **Solution**: Reset sync state and run initial sync again

### Monitoring Sync Health

```typescript
// Check recent errors
npx convex run todoist:queries:getSyncHealth
```

## Testing

### Manual Testing Checklist

- [ ] Initial sync imports all data
- [ ] Create task via API updates Convex immediately
- [ ] Webhook processes updates correctly
- [ ] Hourly sync catches missed updates
- [ ] No duplicate data created

### API Testing with cURL

```bash
# Test Todoist API directly
curl https://api.todoist.com/rest/v2/tasks \
  -H "Authorization: Bearer $TODOIST_API_TOKEN"

# Test Convex HTTP endpoint
curl http://localhost:8000/todoist/webhook \
  -H "Content-Type: application/json" \
  -d '{"event_name": "item:added", "event_data": {...}}'
```

## Performance Tips

1. **Batch Operations**: Use `upsertTasks` instead of individual `upsertTask`
2. **Indexes**: Ensure queries use indexed fields
3. **Pagination**: Implement for large data sets
4. **Caching**: Use Convex's built-in caching

## Deployment Preparation

Before deploying to production:

1. Test all sync paths thoroughly
2. Verify webhook signature validation
3. Set production environment variables
4. Run initial sync with production data
5. Monitor first 24 hours closely