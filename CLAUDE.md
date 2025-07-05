# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React Router v7 application called "Greenbook" that manages staff directory and organizational hierarchy using Microsoft Graph API integration. The app provides staff directory functionality with Microsoft authentication and admin capabilities for managing organizational data.

## Development Commands

- `npm install` - Install dependencies
- `npm run dev` - Start development server (http://localhost:5173)
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run typecheck` - Run type checking

## Database Operations

- `npx prisma db push` - Push schema changes to database
- `npx prisma db migrate` - Run database migrations
- `npx prisma studio` - Open database GUI
- `npx prisma generate` - Generate Prisma client
- `npx prisma db seed` - Seed database with initial data

## Architecture

### Tech Stack
- React Router v7 (SSR framework)
- Prisma ORM with PostgreSQL
- Microsoft Graph API integration
- Tailwind CSS with shadcn/ui components
- Microsoft Authentication (Azure AD/Entra ID)

### Key Directories
- `/app` - Main application code
- `/app/lib` - Server-side utilities and integrations
- `/app/routes` - Route handlers and pages
- `/app/components` - Reusable UI components
- `/prisma` - Database schema and migrations
- `/scripts` - Utility scripts for data management

### Core Services

**Authentication System** (`app/lib/auth.server.ts`)
- Microsoft OAuth integration using remix-auth-microsoft
- Session management with database persistence
- Token refresh mechanism for long-lived sessions
- Admin user authorization system

**Microsoft Graph Integration** (`app/lib/graph.server.ts`)
- User profile fetching and management
- Organizational hierarchy navigation
- Manager/direct report relationships
- Search and filtering capabilities
- Application-level permissions for bulk operations

**Data Synchronization** (`app/lib/sync.server.ts`)
- Full and incremental sync from Microsoft Graph
- Selective sync with filtering options
- Scheduled synchronization using cron jobs
- Sync logging and error handling

**Database Models** (Prisma schema)
- `Staff` - Main user records from Microsoft Graph
- `User` - Application users with roles
- `AdminUser` - Admin privileges
- `SyncLog` - Sync operation tracking
- `SyncSchedule` - Automated sync configuration

### Route Structure
- `/` - Main staff directory
- `/users` - User management
- `/admin` - Admin dashboard with sync controls
- `/profile` - User profile page
- `/debug` - Development utilities

### Authentication Flow
1. Microsoft OAuth login via Azure AD
2. Token storage in database sessions
3. Automatic token refresh using refresh tokens
4. Admin role verification for protected routes

### Data Flow
1. Microsoft Graph API provides source data
2. Sync processes update local database
3. Application serves data from local database
4. Organizational hierarchy maintained in both systems

## Environment Variables

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `MICROSOFT_CLIENT_ID` - Azure app registration client ID
- `MICROSOFT_CLIENT_SECRET` - Azure app client secret
- `MICROSOFT_TENANT_ID` - Azure tenant ID
- `MICROSOFT_REDIRECT_URI` - OAuth redirect URI

## Testing

The application uses the organizational domain filter `@africanunion.org` in Microsoft Graph queries. Update this filter in `app/lib/graph.server.ts` when working with different organizations.