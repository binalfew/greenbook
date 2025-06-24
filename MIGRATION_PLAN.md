# Migration Plan: Graph API to Database-Backed Solution

## Overview

This document outlines the plan to migrate from direct Microsoft Graph API calls to a database-backed solution that maintains the same data structure and functionality while improving scalability and performance.

## Current State

### What We Have Now

- Direct Microsoft Graph API calls for all user data
- Real-time data fetching on every request
- Limited scalability due to API rate limits
- Potential performance issues with large datasets
- No offline capability

### Graph API Functions Currently Used

1. `getMyProfile()` - Current user profile
2. `getUserProfile(userId)` - Specific user profile
3. `getUsers()` - List all users with pagination
4. `searchUsers()` - Search users with filters
5. `getUserPhotoUrl()` - User profile photos
6. `getUserManager()` - Manager information
7. `getUserDirectReports()` - Direct reports
8. `getUserOrgHierarchy()` - Organizational hierarchy
9. `getFilterOptions()` - Available filter options

## Target State

### What We Want

- Database-backed user data with periodic synchronization
- Fast, scalable queries without API rate limits
- Offline capability for basic functionality
- Maintained data structure compatibility
- Incremental sync capabilities

## Database Schema Design

### Enhanced Staff Model

```prisma
model Staff {
  id                    String     @id @default(uuid())
  microsoftId          String     @unique // Microsoft Graph user ID
  displayName          String
  givenName            String?
  surname              String?
  userPrincipalName    String     @unique
  email                String     @unique
  jobTitle             String?
  department           String?
  officeLocation       String?
  mobilePhone          String?
  businessPhones       String[]   // Array of phone numbers
  preferredLanguage    String?
  employeeId           String?
  employeeType         String?
  employeeHireDate     DateTime?
  usageLocation        String?
  accountEnabled       Boolean    @default(true)
  createdDateTime      DateTime?
  lastPasswordChangeDateTime DateTime?
  userType             String?

  // Organizational hierarchy
  managerId            String?
  manager              Staff?     @relation("Manager", fields: [managerId], references: [id])
  directReports        Staff[]    @relation("Manager")

  // Photo
  userPhoto            UserPhoto?

  // Legacy fields (keeping for backward compatibility)
  phone                String?
  photoUrl             String?
  jobTitleId           String?
  jobTitleRef          JobTitle?  @relation(fields: [jobTitleId], references: [id])
  departmentId         String?
  departmentRef        Department? @relation(fields: [departmentId], references: [id])
  employmentType       String?
  expertise            String[]
  biography            String?
  bioEn                String?
  bioFr                String?
  bioAr                String?
  bioPt                String?

  // Metadata
  lastSyncAt           DateTime   @default(now())
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt

  @@index([microsoftId])
  @@index([email])
  @@index([userPrincipalName])
  @@index([department])
  @@index([jobTitle])
  @@index([officeLocation])
  @@index([managerId])
}
```

### New Models

```prisma
model UserPhoto {
  id          String   @id @default(uuid())
  staffId     String   @unique
  staff       Staff    @relation(fields: [staffId], references: [id], onDelete: Cascade)
  photoData   String   // Base64 encoded photo data
  contentType String   @default("image/jpeg")
  lastSyncAt  DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model SyncLog {
  id          String   @id @default(uuid())
  syncType    String   // 'users', 'hierarchy', 'photos'
  status      String   // 'success', 'error', 'partial'
  message     String?
  recordsProcessed Int  @default(0)
  recordsFailed    Int  @default(0)
  startedAt   DateTime @default(now())
  completedAt DateTime?
  createdAt   DateTime @default(now())
}
```

## Migration Strategy

### Phase 1: Database Schema and Services ✅

- [x] Enhanced Staff model with Microsoft Graph fields
- [x] UserPhoto model for storing profile photos
- [x] SyncLog model for tracking synchronization
- [x] Staff service functions (`staff.server.ts`)
- [x] Synchronization service (`sync.server.ts`)

### Phase 2: Data Migration

- [ ] Initial data sync from Microsoft Graph
- [ ] Photo migration
- [ ] Hierarchy relationship setup
- [ ] Data validation and cleanup

### Phase 3: Route Updates ✅

- [x] Updated users index route (`/users`)
- [x] Updated user detail route (`/users/$userId`)
- [x] Updated photo API route (`/api/users/$userId/photo`)
- [x] Added sync API route (`/api/sync`)

### Phase 4: Component Compatibility

- [x] Type adapter for MicrosoftProfile compatibility
- [x] Updated OrgChart component usage
- [x] Maintained existing UI/UX

### Phase 5: Testing and Validation

- [ ] Test all routes with database data
- [ ] Validate data integrity
- [ ] Performance testing
- [ ] Error handling validation

### Phase 6: Deployment and Monitoring

- [ ] Deploy database changes
- [ ] Run initial sync
- [ ] Monitor sync performance
- [ ] Set up automated sync scheduling

## Implementation Details

### Data Synchronization

#### Full Sync Process

1. **User Data Sync**: Fetch all users from Graph API and upsert to database
2. **Hierarchy Sync**: Build manager relationships
3. **Photo Sync**: Download and store user photos (optional)

#### Incremental Sync (Future Enhancement)

- Track last sync timestamp
- Only sync users modified since last sync
- Update hierarchy for changed users only

#### Sync API Endpoints

- `GET /api/sync?action=full` - Full synchronization
- `GET /api/sync?action=incremental` - Incremental sync
- `GET /api/sync?action=user&userId=xxx` - Sync specific user
- `GET /api/sync?action=status` - Get sync status

### Type Compatibility

#### MicrosoftProfile Adapter

```typescript
function staffToMicrosoftProfile(staff: StaffWithPhoto): MicrosoftProfile {
  return {
    id: staff.microsoftId,
    displayName: staff.displayName,
    givenName: staff.givenName || undefined,
    surname: staff.surname || undefined,
    userPrincipalName: staff.userPrincipalName,
    mail: staff.email,
    // ... other fields
  };
}
```

This ensures existing components continue to work without modification.

### Performance Optimizations

#### Database Indexes

- `microsoftId` - Fast lookups by Microsoft ID
- `email` - Email-based searches
- `department`, `jobTitle`, `officeLocation` - Filter queries
- `managerId` - Hierarchy queries

#### Caching Strategy

- Photo caching with 1-hour TTL
- Filter options cached in memory
- User list pagination

## Benefits

### Scalability

- No API rate limits
- Faster query performance
- Reduced external dependencies

### Reliability

- Offline capability
- Better error handling
- Data consistency

### Maintainability

- Centralized data management
- Easier testing
- Better monitoring

### Cost Optimization

- Reduced API calls
- Lower bandwidth usage
- Better resource utilization

## Risks and Mitigation

### Data Freshness

- **Risk**: Data may become stale
- **Mitigation**: Regular sync scheduling, sync status monitoring

### Storage Requirements

- **Risk**: Increased database storage for photos
- **Mitigation**: Photo compression, cleanup strategies

### Migration Complexity

- **Risk**: Complex data migration process
- **Mitigation**: Phased approach, rollback capabilities

## Next Steps

1. **Run Initial Sync**: Execute full data synchronization
2. **Validate Data**: Ensure all data migrated correctly
3. **Test Routes**: Verify all functionality works with database
4. **Performance Test**: Measure query performance improvements
5. **Set Up Monitoring**: Monitor sync status and performance
6. **Schedule Regular Syncs**: Set up automated synchronization

## Monitoring and Maintenance

### Sync Monitoring

- Track sync success/failure rates
- Monitor sync duration
- Alert on sync failures

### Data Quality

- Validate data integrity
- Monitor data freshness
- Track photo coverage

### Performance Metrics

- Query response times
- Database connection usage
- Memory and storage utilization

## Conclusion

This migration provides a solid foundation for scaling the application while maintaining the same user experience. The database-backed approach offers significant performance and reliability improvements while reducing external dependencies.
