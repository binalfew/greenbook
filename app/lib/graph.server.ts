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

// Get all users in the organization (application)
export async function getUsers(
  nextLink?: string
): Promise<{ users: MicrosoftProfile[]; nextLink?: string }> {
  const graphClient = getGraphClientWithAppToken();
  try {
    let response;
    if (nextLink) {
      // Use the full nextLink URL directly
      response = await graphClient.api(nextLink).get();
    } else {
      response = await graphClient
        .api("/users")
        .filter("accountEnabled eq true and userType eq 'Member'")
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
  nextLink?: string
): Promise<{ users: MicrosoftProfile[]; nextLink?: string }> {
  const graphClient = getGraphClientWithAppToken();
  try {
    let response;
    if (nextLink) {
      // Use the full nextLink URL directly
      response = await graphClient.api(nextLink).get();
    } else {
      response = await graphClient
        .api("/users")
        .filter(
          "accountEnabled eq true and userType eq 'Member' and (" +
            `startswith(displayName,'${searchTerm}') or ` +
            `startswith(givenName,'${searchTerm}') or ` +
            `startswith(surname,'${searchTerm}') or ` +
            `startswith(mail,'${searchTerm}')` +
            ")"
        )
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
