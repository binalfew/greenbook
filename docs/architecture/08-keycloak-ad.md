# 08 — Keycloak federated to AD

> **Phase**: 2 (identity + observability) · **Run on**: Keycloak admin UI (browser; nothing on the host) · **Time**: ~90 min including AD-side coordination
>
> Federate Keycloak's `au` realm to AU's existing Active Directory. AD becomes the source of truth for user lifecycle; AD groups map to Keycloak roles; users authenticate with their existing AU credentials. Local accounts in Keycloak get reduced to break-glass only.
>
> **Critical dependency** ([PLAN.md Q3](PLAN.md)): AU IT must provide a **read-only LDAP service account** (or equivalent over LDAPS) before this chapter can be applied. Coordinate with AU's security team; this is the single biggest external dependency in Phase 2.
>
> **Prev**: [07 — Keycloak](07-keycloak.md) · **Next**: [09 — Loki + Grafana](09-loki.md) · **Index**: [README](README.md)

---

## Contents

- [§8.1 Role + threat model](#81-role-threat-model)
- [§8.2 Pre-requisites from AU IT](#82-pre-requisites-from-au-it)
- [§8.3 Add the LDAP user-storage provider](#83-add-the-ldap-user-storage-provider)
- [§8.4 Test user sync](#84-test-user-sync)
- [§8.5 Map AD groups to Keycloak roles](#85-map-ad-groups-to-keycloak-roles)
- [§8.6 Disable local-account login (except break-glass)](#86-disable-local-account-login-except-break-glass)
- [§8.7 Onboard the first SSO consumer (GitLab)](#87-onboard-the-first-sso-consumer-gitlab)
- [§8.8 Audit + monitoring](#88-audit-monitoring)
- [§8.9 Verification](#89-verification)
- [§8.10 Rollback procedure](#810-rollback-procedure)
- [§8.11 Path to Phase 5](#811-path-to-phase-5)

## 8. Keycloak federated to AD

### 8.1 Role + threat model

Once federated, Keycloak's `au` realm becomes a **read-mostly mirror** of AD. Users created in AD appear in Keycloak automatically; users disabled in AD lose access to every SSO-integrated platform service within seconds; user attributes (email, group membership) flow from AD as the source of truth.

Three benefits over standalone Keycloak (chapter 07):

1. **Single user lifecycle.** When AU HR offboards an employee, AD disabling propagates to every platform service. No parallel offboarding ritual.
2. **Existing credentials.** Users log in with their AU domain password (the one they use for email, file shares, Office 365). One password to rotate; one MFA setup if AD enforces it.
3. **Existing audit trail.** AU's existing AD audit logs cover password resets, group membership changes, account lockouts. Keycloak adds session/token events on top, not duplicate user-management events.

**New threat model considerations:**

| Threat                                                | Mitigation                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| AD goes down → Keycloak can't authenticate new logins | Keycloak caches user data; existing tokens valid until expiry. New logins fail until AD is back              |
| AU LDAP service account credentials leak              | Stored in Vault (`kv/platform/keycloak/ad_bind_credentials`); rotated annually with AU IT coordination       |
| LDAP traffic intercepted on AU LAN                    | LDAPS (TCP 636) only — TLS-encrypted; NEVER unencrypted LDAP (TCP 389)                                       |
| Privilege escalation via AD group manipulation        | AU AD's existing change-management controls; Keycloak audit log surfaces unexpected role assignments         |
| Stale Keycloak cache after AD permission revocation   | "Periodic Changed Users Sync" runs hourly to pick up AD changes; force-sync on-demand for urgent revocations |

### 8.2 Pre-requisites from AU IT

This chapter cannot proceed without these from AU's identity team:

| Item                               | Format / value                                              | Vault path                                 |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| LDAP service account DN            | `CN=keycloak-svc,OU=ServiceAccounts,DC=africanunion,DC=org` | `kv/platform/keycloak/ad_bind_credentials` |
| LDAP service account password      | strong, rotation policy 12 months                           | same                                       |
| LDAP base DN for users             | `OU=AU Users,DC=africanunion,DC=org`                        | recorded in Keycloak provider config       |
| LDAP base DN for groups            | `OU=AU Groups,DC=africanunion,DC=org`                       | recorded in Keycloak provider config       |
| LDAPS endpoint (host + port)       | `ldaps://ad.africanunion.org:636`                           | recorded in Keycloak provider config       |
| LDAPS server cert / chain          | PEM file, signed by AU's internal CA or a public CA         | imported into Keycloak's truststore        |
| User attribute mappings            | sAMAccountName ↔ username, mail ↔ email, etc.             | configured in Keycloak                     |
| Allowed AD group filter (optional) | e.g. only `OU=Platform Users` get synced — narrow the scope | LDAP filter string in Keycloak             |

```bash
# Once AU IT delivers these, store the bind credentials in Vault:
$ vault kv put kv/platform/keycloak/ad_bind_credentials \
    bind_dn='CN=keycloak-svc,OU=ServiceAccounts,DC=africanunion,DC=org' \
    bind_password='<from AU IT>' \
    rotated_at="$(date -Iseconds)" \
    rotation_period_days=365
```

> **ℹ Read-only is the right scope**
>
> The service account needs ONLY read access to the user OU + group OU (specifically: enumerate users/groups, read user attributes, read group memberships). It does NOT need write access — Keycloak federation is read-mostly. Some AU policies may grant a limited "password change" capability for self-service password resets via Keycloak; that's a separate decision documented per AU's identity governance.

### 8.3 Add the LDAP user-storage provider

```
Login at https://keycloak.africanunion.org/admin/ as the master-realm
admin (chapter 07 §7.7), then:

au realm → User federation → Add provider → ldap

Required settings:
  - Vendor: Active Directory
  - Connection URL: ldaps://ad.africanunion.org:636
  - Bind type: simple
  - Bind DN: CN=keycloak-svc,OU=ServiceAccounts,DC=africanunion,DC=org
  - Bind credentials: <from Vault>
  - Edit mode: READ_ONLY
    (Phase 2 baseline; if AU policy allows password reset via Keycloak,
    set to WRITABLE later)
  - Users DN: OU=AU Users,DC=africanunion,DC=org
  - Username LDAP attribute: sAMAccountName
  - RDN LDAP attribute: cn
  - UUID LDAP attribute: objectGUID
  - User Object Classes: person, organizationalPerson, user
  - Custom user LDAP filter: (optional — narrow scope here)
  - Search scope: Subtree

Synchronisation:
  - Import Users: ON
  - Sync Registrations: OFF (users come from AD, not from Keycloak self-registration)
  - Periodic Full Sync: ON, every 24 hours
  - Periodic Changed Users Sync: ON, every 1 hour

Cache:
  - Cache Policy: DEFAULT
  - Eviction: every 24 hours

Save → Test connection → Test authentication
```

If "Test connection" or "Test authentication" fails, **STOP** and resolve before continuing. Common failures:

| Symptom                               | Cause                                                    | Fix                                                                                 |
| ------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| "Error connecting to LDAP server"     | Network reachability or LDAPS port blocked               | Verify Keycloak nodes can reach `ad.africanunion.org:636`; check UFW + AU perimeter |
| "Cannot validate server's hostname"   | LDAPS server cert untrusted by Keycloak's JVM truststore | Import AU's CA cert into Keycloak's truststore (see step below)                     |
| "Invalid credentials"                 | Wrong bind DN or password                                | Verify `bind_dn` matches AD's actual schema; re-fetch from Vault                    |
| "User not found in LDAP" on test auth | "Users DN" too narrow OR username attribute wrong        | Check AU IT for correct OU; verify `sAMAccountName` is the username attribute       |

**Importing AU's CA cert into Keycloak's JVM truststore** (if needed):

```bash
# [auishqosrkc01 + auishqosrkc02]

$ sudo cp au-internal-ca.pem /etc/keycloak/au-internal-ca.pem

# Add to JVM truststore (for the keycloak user)
$ sudo -u keycloak keytool -import -trustcacerts \
    -alias au-internal-ca \
    -file /etc/keycloak/au-internal-ca.pem \
    -keystore /opt/keycloak/current/conf/truststore.p12 \
    -storetype PKCS12 \
    -storepass <truststore-password>

# Update keycloak.conf to use the truststore
$ sudo tee -a /etc/keycloak/keycloak.conf > /dev/null <<EOF
truststore-paths=/opt/keycloak/current/conf/truststore.p12
EOF

$ sudo systemctl restart keycloak
```

### 8.4 Test user sync

```
au realm → User federation → ldap → Action menu → Sync all users
```

Watch the admin UI for "User Federation: ldap, Imported X users". Then verify:

```
au realm → Users → check the user list
```

Expected: AU users appear with their sAMAccountName as username, email populated, "Federation Link: ldap" visible on each user's detail page.

**Spot-check a single user**:

```bash
# Pick a known AU user (e.g., your own account):
# au realm → Users → search by username → click → Details tab
# Confirm:
#   - Email: matches AD
#   - Federation Link: ldap (NOT empty — empty means local account)
#   - Attributes: shows AD attributes propagated (e.g., displayName)
```

### 8.5 Map AD groups to Keycloak roles

Group membership in AD should determine permissions in Keycloak (and downstream — GitLab, Vault, Nexus, Grafana).

```
au realm → User federation → ldap → Mappers tab → Create mapper

Group LDAP mapper:
  - Name: au-groups
  - Mapper type: group-ldap-mapper
  - LDAP Groups DN: OU=AU Groups,DC=africanunion,DC=org
  - Group Object Classes: group
  - Membership LDAP Attribute: member
  - Membership Attribute Type: DN
  - User Groups Retrieve Strategy: LOAD_GROUPS_BY_MEMBER_ATTRIBUTE
  - Mode: READ_ONLY
  - Memberof LDAP Attribute: memberOf
  - Sync Groups On Sync: ON

Save → Action menu → Sync LDAP groups to Keycloak
```

Once groups sync, set up role mappings:

```
au realm → Groups → review the imported groups (should match AD's OU)

Standard mapping table for the platform — coordinate with AU's
identity governance for the actual AD group names:

| AD group                          | Keycloak role / group | Platform meaning                           |
| --------------------------------- | --------------------- | ------------------------------------------ |
| AU-Platform-Engineers             | platform-engineers    | Admin on every platform service            |
| AU-App-Developers                 | developers            | Read on platform; admin on owned apps      |
| AU-All-Staff                      | viewers               | Read-only access to UIs that allow it      |

For each row, Keycloak admin UI → Groups → <Group> → Role mappings:
  - Add the appropriate composite role (created in chapter 07 §7.8 if
    not already present)
```

### 8.6 Disable local-account login (except break-glass)

Once AD federation is verified working and operators can log in via SSO, disable local-account login except for the break-glass `admin` account.

```
master realm → Authentication → Flows → Browser → edit
  - Disable "Username Password Form" execution and replace with
    "Identity Provider Redirector" pointing at the LDAP provider.

OR (simpler and reversible):
au realm → Realm Settings → Login → "User registration: OFF"
au realm → Authentication → Required actions → "Verify Profile: enabled"

Local 'admin' in master realm stays enabled — break-glass.
Document the bootstrap admin password rotation policy:
  - 90-day rotation (already in Vault metadata from chapter 07 §7.7)
  - Used ONLY when AD-federated admin login is broken (incident only)
  - Audit log surfaces every use; review weekly
```

### 8.7 Onboard the first SSO consumer (GitLab)

Phase 1 chapter 04 §4.14 outlined the migration path. With AD federation in place, the GitLab → Keycloak integration finishes:

```bash
# (1) Fetch GitLab's OIDC client secret (created in chapter 07 §7.9)
$ vault kv get kv/platform/keycloak/clients/gitlab

# (2) Update /etc/gitlab/gitlab.rb on auishqosrgit01:
gitlab_rails['omniauth_enabled'] = true
gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false
gitlab_rails['omniauth_auto_link_user'] = ['openid_connect']
gitlab_rails['omniauth_providers'] = [
  {
    'name' => 'openid_connect',
    'label' => 'AU SSO',
    'args' => {
      'name' => 'openid_connect',
      'scope' => ['openid', 'profile', 'email'],
      'response_type' => 'code',
      'issuer' => 'https://keycloak.africanunion.org/realms/au',
      'discovery' => true,
      'client_auth_method' => 'query',
      'uid_field' => 'preferred_username',
      'send_scope_to_token_endpoint' => 'false',
      'client_options' => {
        'identifier' => 'gitlab',
        'secret' => '<from Vault>',
        'redirect_uri' => 'https://gitlab.africanunion.org/users/auth/openid_connect/callback'
      }
    }
  }
]

# (3) Apply
$ sudo gitlab-ctl reconfigure

# (4) Test SSO login
#     Logout of GitLab → click "AU SSO" button on login page →
#     redirected to Keycloak → log in with AU AD creds → redirected
#     back to GitLab → first time: account auto-linked to existing
#     local GitLab account by email (omniauth_auto_link_user)

# (5) Once verified: Admin Area → Settings → Sign-in restrictions:
#     Disable "Sign-in enabled" for password (force SSO except for root)
```

The same pattern (OIDC client → secret in Vault → service config update) applies to Vault, Nexus, Nomad UI, and Grafana. Each service's chapter has the per-service integration section; the Keycloak-side work (creating the OIDC client) is already done in chapter 07 §7.9.

### 8.8 Audit + monitoring

After federation, watch:

- **Keycloak event log** (already enabled in chapter 07 §7.11): now records LDAP-source logins, attribute syncs, group-membership-derived role changes.
- **AD audit log** (AU IT's domain, not ours): records the bind-account activity (read attempts), service-account password rotations, LDAP traffic spikes.
- **Sync failures**: Keycloak → User Federation → ldap → "Sync changed users" failures appear in `journalctl -u keycloak`. Set up an Alertmanager rule (Phase 2 chapter 12) to page if periodic sync fails N consecutive times.

```bash
# Watch sync events live during the first periodic-sync cycle
$ sudo journalctl -u keycloak -f | grep -i 'sync\|federation'
# Expected: lines about "Periodic Changed Users Sync started/completed"
# every hour, with a count of users updated.
```

### 8.9 Verification

```bash
# (1) Federation provider configured + test passes
#     Admin UI → au realm → User federation → ldap → Test connection → Test authentication
#     Both should return success messages

# (2) Users imported
#     au realm → Users → search returns AU users with Federation Link: ldap

# (3) Groups imported + mapped
#     au realm → Groups → AU groups visible
#     <Group> → Role mappings shows the assigned platform role

# (4) End-to-end SSO login (browser test)
#     - Logout of all services
#     - Open https://gitlab.africanunion.org/
#     - Click "AU SSO" → redirected to Keycloak → AD-validated login
#     - Land in GitLab as the AD-authenticated user

# (5) Group-based authorisation works
#     - As a member of AU-Platform-Engineers, GitLab admin pages should
#       be accessible
#     - As a member of AU-All-Staff (only), admin pages should be denied

# (6) AD revocation propagates
#     - AU IT disables a test user in AD
#     - Within ~1 hour (next periodic sync), Keycloak shows the user
#       as disabled
#     - That user can no longer log in to GitLab / any SSO consumer
#     - Existing tokens for that user expire within 5 min (access)
#       to 30 min (refresh)

# (7) Vault has the bind credentials + rotation metadata
$ vault kv get kv/platform/keycloak/ad_bind_credentials
# Expected: bind_dn, bind_password, rotation_period_days=365 visible
```

### 8.10 Rollback procedure

If AD federation breaks production logins, fall back to local accounts:

```
1. Login at https://keycloak.africanunion.org/admin/ as master-realm
   admin (the break-glass account from chapter 07 §7.7)
2. au realm → User federation → ldap → toggle "Enabled: OFF"
3. The cached/imported users remain accessible via local password
   authentication (if enabled). Operators may need to set local
   passwords via admin UI for any user whose AD password was the
   only credential.
4. Investigate the federation issue (logs at journalctl -u keycloak;
   AD-side checks coordinated with AU IT).
5. Once root cause is fixed, toggle Enabled: ON and force a sync
   (Action menu → Sync all users).
```

> **ℹ Practice this rollback in a non-production drill**
>
> Before relying on it in an outage, do a controlled drill: disable federation, verify admin login still works, re-enable, verify federation comes back. Run quarterly so operators are confident in the path.

### 8.11 Path to Phase 5

Phase 5 doesn't fundamentally change AD federation — it's already the right shape. Phase 5 [chapter 23 — Runbook automation](23-automation.md) adds:

- Automated bind-account password rotation (annually) via Vault PKI / dynamic secrets pattern
- Alertmanager rules covering sync-failure scenarios
- Self-service AD-group request workflow (out of scope for this guide; AU IT system)

Other Phase 1 services that adopt SSO via the same pattern as §8.7 (GitLab):

- **Vault** (chapter 03 §3.7 Phase 2 upgrade): Vault OIDC auth method → Keycloak; operator tokens issued based on `platform-engineers` group membership
- **Nexus** (chapter 06 §6.7 / §6.12): Nexus SAML 2.0 federation → Keycloak; AD-group → Nexus role mapping
- **Nomad UI** (chapter 05 §5.6): Nomad ACL OIDC method → Keycloak; ACL token issuance keyed on group claims
- **Grafana** (chapter 09 — TBD): Grafana OAuth → Keycloak; per-org role mapping by group

Each integration is documented in its own chapter; chapter 08's contribution is the **federation foundation** that makes them all possible.

---
