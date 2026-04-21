export interface PaginatedQueryOptions {
  where?: Record<string, unknown>;
  orderBy?: Array<Record<string, "asc" | "desc">>;
  page: number;
  pageSize: number;
}

export interface ServiceContext {
  userId: string;
  tenantId?: string;
  isSuperAdmin?: boolean;
  ipAddress?: string;
  userAgent?: string;
}

export interface TenantServiceContext extends ServiceContext {
  tenantId: string;
}
