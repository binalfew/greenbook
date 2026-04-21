export const SSO_PROVIDER_OPTIONS = [
  { value: "OKTA", label: "Okta" },
  { value: "AZURE_AD", label: "Azure AD (Entra ID)" },
  { value: "GOOGLE", label: "Google Workspace" },
  { value: "CUSTOM_OIDC", label: "Custom OIDC" },
  { value: "CUSTOM_SAML", label: "Custom SAML" },
] as const;

export const SSO_PROTOCOL_OPTIONS = [
  { value: "OIDC", label: "OpenID Connect (OIDC)" },
  { value: "SAML", label: "SAML 2.0" },
] as const;

export const IDP_INSTRUCTIONS: Record<string, { title: string; steps: string[] }> = {
  OKTA: {
    title: "Okta",
    steps: [
      "Sign in to your Okta admin console",
      "Go to Applications → Create App Integration → OIDC - OpenID Connect → Web Application",
      "Set the Sign-in redirect URI to the Callback URL shown below",
      "Copy the Client ID and Client Secret into the fields above",
      "The Issuer URL is typically: https://your-domain.okta.com/oauth2/default",
    ],
  },
  AZURE_AD: {
    title: "Azure AD (Entra ID)",
    steps: [
      "Sign in to the Azure Portal",
      "Go to Microsoft Entra ID → App registrations → New registration",
      "Set the Redirect URI (Web) to the Callback URL shown below",
      "Under Certificates & Secrets, create a new client secret",
      "The Issuer URL is: https://login.microsoftonline.com/{tenant-id}/v2.0",
    ],
  },
  GOOGLE: {
    title: "Google Workspace",
    steps: [
      "Go to the Google Cloud Console → APIs & Services → Credentials",
      "Create an OAuth 2.0 Client ID (Web application)",
      "Add the Callback URL shown below as an Authorized redirect URI",
      "Copy the Client ID and Client Secret",
      "The Issuer URL is: https://accounts.google.com",
    ],
  },
  CUSTOM_OIDC: {
    title: "Custom OIDC Provider",
    steps: [
      "Register a new OIDC client application with your identity provider",
      "Set the redirect URI to the Callback URL shown below",
      "Ensure the provider supports the openid, email, and profile scopes",
      "Enter the Issuer URL (must serve a .well-known/openid-configuration endpoint)",
    ],
  },
  CUSTOM_SAML: {
    title: "Custom SAML Provider",
    steps: [
      "Register a new SAML 2.0 application with your identity provider",
      "Set the ACS (Assertion Consumer Service) URL to the Callback URL shown below",
      "Set the SP Entity ID to your application URL (shown below)",
      "Download the IdP signing certificate (X.509 PEM format)",
      "Copy the IdP Entity ID, SSO URL, and certificate into the fields above",
      "Set NameID format to email address",
    ],
  },
  OKTA_SAML: {
    title: "Okta (SAML)",
    steps: [
      "Sign in to your Okta admin console",
      "Go to Applications → Create App Integration → SAML 2.0",
      "Set the Single sign-on URL (ACS) to the Callback URL shown below",
      "Set Audience URI (SP Entity ID) to your application URL",
      "Under Attribute Statements, add: email → user.email, firstName → user.firstName, lastName → user.lastName",
      "Download the IdP signing certificate from the SSO settings",
      "Copy the Identity Provider Issuer and SSO URL",
    ],
  },
  AZURE_AD_SAML: {
    title: "Azure AD (SAML)",
    steps: [
      "In Azure Portal → Enterprise Applications → New application → Create your own",
      "Go to Single sign-on → SAML",
      "Set Reply URL (ACS) to the Callback URL shown below",
      "Set Identifier (Entity ID) to your application URL",
      "Download Certificate (Base64) from the SAML Signing Certificate section",
      "Copy the Login URL and Azure AD Identifier",
    ],
  },
};
