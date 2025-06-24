import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials";

// TypeScript interface for Microsoft Graph user profile
export interface MicrosoftProfile {
  id: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  userPrincipalName: string;
  mail?: string;
  jobTitle?: string;
  department?: string;
  officeLocation?: string;
  mobilePhone?: string;
  businessPhones?: string[];
  preferredLanguage?: string;
  employeeId?: string;
  employeeType?: string;
  employeeHireDate?: string;
  usageLocation?: string;
  accountEnabled?: boolean;
  createdDateTime?: string;
  lastPasswordChangeDateTime?: string;
  photoUrl?: string | null; // URL to user's profile photo
}

// Delegated: Graph client with user access token
function getGraphClientWithUserToken(accessToken: string) {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

// Application: Graph client with app credentials
function getGraphClientWithAppToken() {
  const credential = new ClientSecretCredential(
    process.env.MICROSOFT_TENANT_ID!,
    process.env.MICROSOFT_CLIENT_ID!,
    process.env.MICROSOFT_CLIENT_SECRET!
  );
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });
  return Client.initWithMiddleware({ authProvider });
}

// Get current user's profile (delegated)
export async function getMyProfile(
  accessToken: string
): Promise<MicrosoftProfile> {
  const graphClient = getGraphClientWithUserToken(accessToken);
  try {
    const user = await graphClient
      .api("/me")
      .select([
        "id",
        "displayName",
        "givenName",
        "surname",
        "userPrincipalName",
        "mail",
        "jobTitle",
        "department",
        "officeLocation",
        "mobilePhone",
        "businessPhones",
        "preferredLanguage",
        "employeeId",
        "employeeType",
        "employeeHireDate",
        "usageLocation",
        "accountEnabled",
        "createdDateTime",
        "lastPasswordChangeDateTime",
      ])
      .get();
    return user;
  } catch (error) {
    console.error("Error fetching my profile:", error);
    throw new Error("Failed to fetch profile from Microsoft Graph");
  }
}

// Get user's profile photo URL
export async function getUserPhotoUrl(userId: string): Promise<string | null> {
  const graphClient = getGraphClientWithAppToken();
  try {
    const photo = await graphClient
      .api(`/users/${userId}/photo/$value`)
      .responseType("arraybuffer" as any)
      .get();

    // Convert the photo to a data URL
    const buffer = Buffer.from(photo);
    const base64 = buffer.toString("base64");
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    // User might not have a photo, return null
    return null;
  }
}

// Get all users in the organization (application)
export async function getUsers(
  nextLink?: string,
  filters?: {
    department?: string;
    jobTitle?: string;
    officeLocation?: string;
  }
): Promise<{ users: MicrosoftProfile[]; nextLink?: string }> {
  const graphClient = getGraphClientWithAppToken();
  try {
    let response;
    if (nextLink) {
      // Use the full nextLink URL directly
      response = await graphClient.api(nextLink).get();
    } else {
      let filterQuery =
        "accountEnabled eq true and userType eq 'Member' and endswith(mail,'@africanunion.org')";

      // Add additional filters
      if (filters?.department) {
        filterQuery += ` and department eq '${filters.department}'`;
      }
      if (filters?.jobTitle) {
        filterQuery += ` and jobTitle eq '${filters.jobTitle}'`;
      }
      if (filters?.officeLocation) {
        filterQuery += ` and officeLocation eq '${filters.officeLocation}'`;
      }

      response = await graphClient
        .api("/users")
        .filter(filterQuery)
        .header("ConsistencyLevel", "eventual")
        .select([
          "id",
          "displayName",
          "givenName",
          "surname",
          "userPrincipalName",
          "mail",
          "jobTitle",
          "department",
          "officeLocation",
          "mobilePhone",
          "businessPhones",
          "preferredLanguage",
          "employeeId",
          "employeeType",
          "employeeHireDate",
          "usageLocation",
          "accountEnabled",
          "createdDateTime",
          "lastPasswordChangeDateTime",
          "userType",
        ])
        .get();
    }

    return {
      users: response.value,
      nextLink: response["@odata.nextLink"],
    };
  } catch (error) {
    console.error("Error fetching users:", error);
    throw new Error("Failed to fetch users from Microsoft Graph");
  }
}

// Search users in the organization (application)
export async function searchUsers(
  searchTerm: string,
  nextLink?: string,
  filters?: {
    department?: string;
    jobTitle?: string;
    officeLocation?: string;
  }
): Promise<{ users: MicrosoftProfile[]; nextLink?: string }> {
  const graphClient = getGraphClientWithAppToken();
  try {
    let response;
    if (nextLink) {
      // Use the full nextLink URL directly
      response = await graphClient.api(nextLink).get();
    } else {
      let filterQuery =
        `accountEnabled eq true and userType eq 'Member' and endswith(mail,'@africanunion.org') and (` +
        `startswith(displayName,'${searchTerm}') or ` +
        `startswith(givenName,'${searchTerm}') or ` +
        `startswith(surname,'${searchTerm}') or ` +
        `startswith(mail,'${searchTerm}')` +
        `)`;

      // Add additional filters
      if (filters?.department) {
        filterQuery += ` and department eq '${filters.department}'`;
      }
      if (filters?.jobTitle) {
        filterQuery += ` and jobTitle eq '${filters.jobTitle}'`;
      }
      if (filters?.officeLocation) {
        filterQuery += ` and officeLocation eq '${filters.officeLocation}'`;
      }

      response = await graphClient
        .api("/users")
        .filter(filterQuery)
        .header("ConsistencyLevel", "eventual")
        .select([
          "id",
          "displayName",
          "givenName",
          "surname",
          "userPrincipalName",
          "mail",
          "jobTitle",
          "department",
          "officeLocation",
          "mobilePhone",
          "businessPhones",
          "preferredLanguage",
          "employeeId",
          "employeeType",
          "employeeHireDate",
          "usageLocation",
          "accountEnabled",
          "createdDateTime",
          "lastPasswordChangeDateTime",
          "userType",
        ])
        .get();
    }

    return {
      users: response.value,
      nextLink: response["@odata.nextLink"],
    };
  } catch (error) {
    console.error("Error searching users:", error);
    throw new Error("Failed to search users in Microsoft Graph");
  }
}

// Get user profile by userId from Microsoft Graph, using the application client
export async function getUserProfile(
  userId: string
): Promise<MicrosoftProfile> {
  const graphClient = getGraphClientWithAppToken();
  try {
    const user = await graphClient
      .api(`/users/${userId}`)
      .select([
        "id",
        "displayName",
        "givenName",
        "surname",
        "userPrincipalName",
        "mail",
        "jobTitle",
        "department",
        "officeLocation",
        "mobilePhone",
        "businessPhones",
        "preferredLanguage",
        "employeeId",
        "employeeType",
        "employeeHireDate",
        "usageLocation",
        "accountEnabled",
        "createdDateTime",
        "lastPasswordChangeDateTime",
      ])
      .get();
    return user;
  } catch (error) {
    console.error("Error fetching user profile:", error);
    throw new Error("Failed to fetch user profile from Microsoft Graph");
  }
}

// Get available filter options (departments, job titles, office locations)
export async function getFilterOptions(): Promise<{
  departments: string[];
  jobTitles: string[];
  officeLocations: string[];
}> {
  const graphClient = getGraphClientWithAppToken();
  try {
    const response = await graphClient
      .api("/users")
      .filter(
        "accountEnabled eq true and userType eq 'Member' and endswith(mail,'@africanunion.org')"
      )
      .header("ConsistencyLevel", "eventual")
      .select(["department", "jobTitle", "officeLocation"])
      .get();

    const departments = [
      ...new Set(
        response.value
          .map((user: any) => user.department)
          .filter((dept: any): dept is string => Boolean(dept))
      ),
    ] as string[];

    const jobTitles = [
      ...new Set(
        response.value
          .map((user: any) => user.jobTitle)
          .filter((title: any): title is string => Boolean(title))
      ),
    ] as string[];

    const officeLocations = [
      ...new Set(
        response.value
          .map((user: any) => user.officeLocation)
          .filter((location: any): location is string => Boolean(location))
      ),
    ] as string[];

    return {
      departments: departments.sort(),
      jobTitles: jobTitles.sort(),
      officeLocations: officeLocations.sort(),
    };
  } catch (error) {
    console.error("Error fetching filter options:", error);
    return { departments: [], jobTitles: [], officeLocations: [] };
  }
}

// Get user's manager information
export async function getUserManager(
  userId: string
): Promise<MicrosoftProfile | null> {
  const graphClient = getGraphClientWithAppToken();
  try {
    const manager = await graphClient
      .api(`/users/${userId}/manager`)
      .select([
        "id",
        "displayName",
        "givenName",
        "surname",
        "userPrincipalName",
        "mail",
        "jobTitle",
        "department",
        "officeLocation",
        "mobilePhone",
        "businessPhones",
        "employeeId",
        "accountEnabled",
      ])
      .get();
    return manager;
  } catch (error) {
    // User might not have a manager, return null
    return null;
  }
}

// Get user's direct reports
export async function getUserDirectReports(
  userId: string
): Promise<MicrosoftProfile[]> {
  const graphClient = getGraphClientWithAppToken();
  try {
    const response = await graphClient
      .api(`/users/${userId}/directReports`)
      .select([
        "id",
        "displayName",
        "givenName",
        "surname",
        "userPrincipalName",
        "mail",
        "jobTitle",
        "department",
        "officeLocation",
        "mobilePhone",
        "businessPhones",
        "employeeId",
        "accountEnabled",
      ])
      .get();
    return response.value || [];
  } catch (error) {
    // User might not have direct reports, return empty array
    return [];
  }
}

// Get user's organizational hierarchy (manager chain)
export async function getUserOrgHierarchy(userId: string): Promise<{
  manager: MicrosoftProfile | null;
  directReports: MicrosoftProfile[];
}> {
  const [manager, directReports] = await Promise.all([
    getUserManager(userId),
    getUserDirectReports(userId),
  ]);

  return {
    manager,
    directReports,
  };
}

// Get full manager chain (hierarchy) for a user
export async function getUserManagerChain(
  userId: string
): Promise<MicrosoftProfile[]> {
  const graphClient = getGraphClientWithAppToken();
  const managers: MicrosoftProfile[] = [];

  try {
    let currentUserId = userId;

    // Follow the manager chain up to 10 levels to prevent infinite loops
    for (let i = 0; i < 10; i++) {
      const manager = await graphClient
        .api(`/users/${currentUserId}/manager`)
        .select([
          "id",
          "displayName",
          "givenName",
          "surname",
          "userPrincipalName",
          "mail",
          "jobTitle",
          "department",
          "officeLocation",
          "mobilePhone",
          "businessPhones",
          "employeeId",
          "accountEnabled",
        ])
        .get();

      managers.push(manager);
      currentUserId = manager.id;
    }
  } catch (error) {
    // Reached the top of the hierarchy or user has no manager
  }

  return managers;
}
