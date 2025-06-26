# Selective Sync Guide

This guide explains how to use selective synchronization to sync specific types of data from Microsoft Graph to your local database.

## Sync Types

### 1. **Users** (Default: Enabled)

- Syncs user profiles and basic information
- Updates: `Staff` table
- **When to use**: When user data changes or new users are added

### 2. **Reference Data** (Default: Disabled)

- Syncs departments, job titles, and offices
- Updates: `Department`, `JobTitle`, `Office` tables
- **When to use**: When organizational structure changes

### 3. **Hierarchy** (Default: Disabled)

- Builds organizational hierarchy relationships
- Updates: `Staff.managerId` relationships
- **When to use**: When reporting relationships change

### 4. **Link References** (Default: Enabled when syncing users/reference data)

- Links staff records to reference table IDs
- Updates: `Staff.departmentId`, `Staff.jobTitleId`, `Staff.officeId`
- **When to use**: When syncing users or reference data

## Usage Examples

### Full Sync (All Data)

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d "action=selective_sync&users=true&referenceData=true&hierarchy=true&linkReferences=true"
```

### User-Only Sync

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d "action=selective_sync&users=true&referenceData=false&hierarchy=false&linkReferences=true"
```

### Hierarchy Update Only

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d "action=selective_sync&users=false&referenceData=false&hierarchy=true&linkReferences=false"
```

## Common Sync Patterns

### 1. **Daily Maintenance**

```bash
# Sync users and hierarchy daily
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d "action=selective_sync&users=true&referenceData=false&hierarchy=true&linkReferences=true"
```

### 2. **Weekly Full Sync**

```bash
# Complete sync including reference data
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d "action=selective_sync&users=true&referenceData=true&hierarchy=true&linkReferences=true"
```

### 3. **Reference Data Update**

```bash
# Update organizational structure
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d "action=selective_sync&users=false&referenceData=true&hierarchy=false&linkReferences=true"
```

## Best Practices

1. **Start with users**: Most syncs should include `users: true`
2. **Include linkReferences**: When syncing users or reference data, include `linkReferences: true`
3. **Hierarchy updates**: Use `hierarchy: true` when organizational structure changes
4. **Reference data**: Only sync when departments/job titles change
5. **Scheduled syncs**: Use cron jobs for regular maintenance

## Dependencies

- **Users**: Required for hierarchy syncs
- **Reference Data**: Required for proper staff-reference linking
- **Link References**: Should be enabled when syncing users or reference data

## Monitoring

Check sync status via the admin interface or API:

```bash
curl http://localhost:3000/api/sync/status
```

This will show recent sync logs and current database statistics.
