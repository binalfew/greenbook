# Migration Plan: Microsoft Graph Integration

## Overview

This document outlines the migration plan for integrating Microsoft Graph API to replace the existing placeholder data with real organizational data.

## Current State

- ✅ Basic Remix application structure
- ✅ Authentication with Microsoft OAuth
- ✅ Database schema with Staff, Department, JobTitle, Office models
- ✅ User management and session handling
- ✅ Basic UI components and routing
- ✅ Sync infrastructure and logging

## Target State

- ✅ Microsoft Graph API integration
- ✅ Real-time user data synchronization
- ✅ Organizational hierarchy management
- ✅ Reference data management (departments, job titles, offices)
- ✅ Selective sync capabilities
- ✅ Sync scheduling and monitoring

## Implementation Phases

### Phase 1: Core Infrastructure ✅

1. **Database Schema** ✅

   - Staff model with Microsoft Graph fields
   - Department, JobTitle, Office reference tables
   - SyncLog for tracking synchronization
   - SyncSchedule for automated syncs

2. **Microsoft Graph Client** ✅

   - Application-level authentication
   - User profile fetching
   - Manager relationship resolution
   - Organizational hierarchy building

3. **Sync Engine** ✅
   - Selective sync capabilities
   - Incremental sync support
   - Error handling and retry logic
   - Sync status tracking

### Phase 2: Data Synchronization ✅

1. **User Sync** ✅

   - Fetch users from Microsoft Graph
   - Map to local Staff model
   - Handle updates and new users
   - Maintain data consistency

2. **Reference Data Sync** ✅

   - Extract departments, job titles, offices
   - Create/update reference tables
   - Link staff to reference data
   - Maintain referential integrity

3. **Hierarchy Sync** ✅
   - Build manager-direct report relationships
   - Update organizational structure
   - Handle hierarchy changes
   - Support multi-level management chains

### Phase 3: Advanced Features ✅

1. **Selective Sync** ✅

   - Choose specific data types to sync
   - Optimize sync performance
   - Reduce API usage
   - Support targeted updates

2. **Sync Scheduling** ✅

   - Automated sync schedules
   - Cron-based scheduling
   - Configurable sync options
   - Schedule management UI

3. **Monitoring & Logging** ✅
   - Sync status tracking
   - Performance metrics
   - Error reporting
   - Audit trail

## Database Schema

### Staff Model

```prisma
model Staff {
  id                         String    @id @default(uuid())
  microsoftId                String    @unique // Microsoft Graph user ID
  displayName                String
  givenName                  String?
  surname                    String?
  userPrincipalName          String    @unique
  email                      String    @unique
  jobTitle                   String?
  department                 String?
  officeLocation             String?
  mobilePhone                String?
  businessPhones             String[] // Array of phone numbers
  preferredLanguage          String?
  employeeId                 String?
  employeeType               String?
  employeeHireDate           DateTime?
  usageLocation              String?
  accountEnabled             Boolean   @default(true)
  createdDateTime            DateTime?
  lastPasswordChangeDateTime DateTime?
  userType                   String?

  // Organizational hierarchy
  managerId     String?
  manager       Staff?  @relation("Manager", fields: [managerId], references: [id])
  directReports Staff[] @relation("Manager")

  // Office relationship
  officeId String?
  office   Office? @relation(fields: [officeId], references: [id])

  // Legacy fields (keeping for backward compatibility)
  phone          String?
  jobTitleId     String?
  jobTitleRef    JobTitle?   @relation(fields: [jobTitleId], references: [id])
  departmentId   String?
  departmentRef  Department? @relation(fields: [departmentId], references: [id])
  employmentType String?
  expertise      String[]
  biography      String?
  bioEn          String?
  bioFr          String?
  bioAr          String?
  bioPt          String?

  // Metadata
  lastSyncAt DateTime @default(now())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([microsoftId])
  @@index([email])
  @@index([userPrincipalName])
  @@index([department])
  @@index([jobTitle])
  @@index([officeLocation])
  @@index([managerId])
  @@index([officeId])
}
```

### Reference Tables

```prisma
model Office {
  id        String   @id @default(uuid())
  name      String   @unique
  staff     Staff[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Department {
  id    String  @id @default(uuid())
  name  String  @unique
  staff Staff[]
}

model JobTitle {
  id    String  @id @default(uuid())
  title String  @unique
  staff Staff[]
}
```

### Sync Infrastructure

```prisma
model SyncLog {
  id               String        @id @default(uuid())
  syncType         String // 'users', 'hierarchy', 'full_sync', 'selective_sync', 'incremental_sync'
  status           String // 'running', 'success', 'error', 'partial', 'cancelled'
  message          String?
  recordsProcessed Int           @default(0)
  recordsFailed    Int           @default(0)
  startedAt        DateTime      @default(now())
  completedAt      DateTime?
  createdAt        DateTime      @default(now())
  masterSyncLogId  String? // Reference to master sync log for full syncs
  scheduleId       String? // Reference to schedule that triggered this sync
  schedule         SyncSchedule? @relation(fields: [scheduleId], references: [id])
}

model SyncSchedule {
  id             String    @id @default(uuid())
  name           String    @unique
  description    String?
  syncType       String // 'incremental', 'full', 'selective'
  cronExpression String // Cron expression for scheduling
  syncOptions    Json // Stored sync options as JSON
  enabled        Boolean   @default(true)
  lastRun        DateTime?
  nextRun        DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  // Relations
  syncLogs SyncLog[]
}
```

## API Integration

### Microsoft Graph Functions

- ✅ `getUsers()` - Fetch all users with pagination
- ✅ `getUserProfile()` - Get individual user profile
- ✅ `getUserManager()` - Get user's manager
- ✅ `getUserDirectReports()` - Get user's direct reports
- ✅ `getFilterOptions()` - Get departments, job titles, offices

### Sync Functions

- ✅ `selectiveSync()` - Sync specific data types
- ✅ `syncAllUsers()` - Full sync for backward compatibility
- ✅ `incrementalSync()` - Sync only changed data
- ✅ `syncUser()` - Sync individual user
- ✅ `cancelSync()` - Cancel running sync
- ✅ `getSyncStatus()` - Get sync status and statistics

## UI Components

### Admin Interface

- ✅ Sync management dashboard
- ✅ Selective sync controls
- ✅ Schedule management
- ✅ Sync status monitoring
- ✅ Reference data management

### User Interface

- ✅ User list with filtering
- ✅ Individual user profiles
- ✅ Organizational hierarchy display
- ✅ Search and pagination

## Configuration

### Environment Variables

```env
MICROSOFT_TENANT_ID=your-tenant-id
MICROSOFT_CLIENT_ID=your-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
DATABASE_URL=your-database-url
SESSION_SECRET=your-session-secret
```

### Sync Options

```typescript
interface SyncOptions {
  users?: boolean;
  referenceData?: boolean;
  hierarchy?: boolean;
  linkReferences?: boolean;
}
```

## Migration Steps

### 1. Database Setup ✅

- [x] Run Prisma migrations
- [x] Seed initial data
- [x] Verify schema integrity

### 2. Microsoft Graph Integration ✅

- [x] Configure application permissions
- [x] Implement Graph client
- [x] Test API connectivity
- [x] Handle authentication

### 3. Sync Implementation ✅

- [x] User data synchronization
- [x] Reference data extraction
- [x] Hierarchy relationship building
- [x] Error handling and logging

### 4. UI Development ✅

- [x] Admin sync interface
- [x] User management views
- [x] Organizational charts
- [x] Search and filtering

### 5. Testing & Validation ✅

- [x] Sync functionality testing
- [x] Data integrity verification
- [x] Performance optimization
- [x] Error scenario handling

## Performance Considerations

- **Batch processing**: Process users in batches to avoid memory issues
- **Pagination**: Use Microsoft Graph pagination for large datasets
- **Caching**: Implement caching for frequently accessed data
- **Incremental syncs**: Only sync changed data to reduce API usage
- **Parallel processing**: Use concurrent operations where possible

## Security Considerations

- **Application permissions**: Use least-privilege access
- **Token management**: Secure storage and rotation of access tokens
- **Data validation**: Validate all incoming data from Microsoft Graph
- **Error handling**: Don't expose sensitive information in error messages
- **Audit logging**: Track all sync operations for security monitoring

## Monitoring & Maintenance

- **Sync monitoring**: Track sync success rates and performance
- **Error tracking**: Monitor and alert on sync failures
- **Data quality**: Regular validation of synchronized data
- **Performance metrics**: Monitor API usage and response times
- **Capacity planning**: Monitor database growth and API limits

## Future Enhancements

1. **Advanced filtering**: Support for complex user queries
2. **Real-time updates**: Webhook-based real-time synchronization
3. **Data analytics**: Sync performance and data quality analytics
4. **Multi-tenant support**: Support for multiple organizations
5. **API rate limiting**: Intelligent rate limiting and retry logic
6. **Data archival**: Historical data management and cleanup
7. **Export capabilities**: Data export for reporting and analysis
8. **Integration APIs**: REST APIs for external system integration
