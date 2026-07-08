# Client Credentials App-Only Setup

Client credentials auth lets Outlook Assistant run without the delegated refresh-token expiry window. It is intended for Microsoft 365 work/school tenants and unattended deployments.

Use device-code auth unless you specifically need unattended app-only operation. App-only permissions are application permissions: without Exchange scoping, the app can access every mailbox in the tenant.

## Requirements

- Microsoft 365 work/school tenant
- Entra ID app registration
- Tenant-admin consent for Microsoft Graph application permissions
- X.509 certificate and private key in PEM files
- Exchange mailbox scoping to the exact mailbox Outlook Assistant may access

Personal Outlook.com, Hotmail, and Live.com accounts do not support app-only Graph application permissions.

## 1. Generate a Certificate

Generate a local certificate and private key:

```bash
openssl req -x509 -newkey rsa:2048 -keyout outlook-assistant-key.pem -out outlook-assistant-cert.pem -days 365 -nodes -subj "/CN=outlook-assistant"
chmod 600 outlook-assistant-key.pem outlook-assistant-cert.pem
```

Keep the private key local. Do not commit `.pem` files. The repository `.gitignore` excludes `*.pem`, but file permissions and secret handling still matter.

## 2. Upload the Certificate

In Azure Portal:

1. Open **Microsoft Entra ID > App registrations > your app**.
2. Open **Certificates & secrets > Certificates**.
3. Upload `outlook-assistant-cert.pem`.

Do not create a client secret for this flow. Client credentials auth uses the certificate private key to sign a client assertion.

## 3. Grant Application Permissions

Open **API permissions > Add a permission > Microsoft Graph > Application permissions** and add only what your deployment needs:

- `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
- `Calendars.Read`, `Calendars.ReadWrite`
- `Contacts.Read`, `Contacts.ReadWrite`
- `MailboxSettings.ReadWrite`
- To Do task permissions only where Microsoft Graph supports application permissions for the specific operation. Microsoft currently documents list/read with `Tasks.Read.All`, user-targeted update with `Tasks.ReadWrite.All`, and task creation as delegated-only. Keep delegated auth for full `manage-tasks` write parity.

Then select **Grant admin consent**.

Application permissions are not the same as delegated scopes. Delegated `Tasks.Read`/`Tasks.ReadWrite` are not valid for app-only To Do access; use the application permission variants Microsoft exposes for your tenant, and expect delegated-only Graph operations to fail cleanly.

## 4. Scope Mailbox Access

This is required for production use.

Application permissions can cover every mailbox in the organisation by default. Restrict the app to the target mailbox before giving it to an AI assistant.

Preferred: use **RBAC for Applications** in Exchange Online to scope the app to the mailbox or a small management scope.

Legacy alternative: use **Application Access Policies** with `New-ApplicationAccessPolicy`.

After scoping, verify that the app cannot read another mailbox.

## 5. Configure Outlook Assistant

Set these environment variables in your MCP client config or process environment:

```bash
OUTLOOK_AUTH_METHOD=client-credentials
OUTLOOK_CLIENT_ID=your-application-client-id
OUTLOOK_TENANT_ID=11111111-2222-3333-4444-555555555555
OUTLOOK_CERT_PATH=/absolute/path/to/outlook-assistant-cert.pem
OUTLOOK_KEY_PATH=/absolute/path/to/outlook-assistant-key.pem
OUTLOOK_TARGET_USER=user@your-domain.com
OUTLOOK_AUTH_AUDIENCE=11111111-2222-3333-4444-555555555555
```

`OUTLOOK_AUTH_AUDIENCE` must be the same tenant GUID for app-only auth. Values like `common`, `consumers`, and `organizations` are delegated-auth audiences and are rejected for app-only Graph permissions.

## 6. Keep Send Guards On

For app-only deployments, configure both safety belts:

```bash
OUTLOOK_MAX_EMAILS_PER_SESSION=10
OUTLOOK_ALLOWED_RECIPIENTS=your-domain.com,trusted@example.com
```

These guards do not replace Microsoft permission scoping. They reduce accidental sends in AI-assisted workflows.

## 7. Verify

Run:

```json
{ "action": "authenticate", "method": "client-credentials" }
```

Then:

```json
{ "action": "status" }
```

The status output should say `Authenticated with client credentials (app-only)` and show the configured target mailbox.

## Troubleshooting

- `AADSTS65001` or `consent_required`: tenant-admin consent has not been granted for application permissions.
- `OUTLOOK_TENANT_ID must be a tenant GUID`: replace `common`, `consumers`, or `organizations` with the Directory tenant ID.
- `Access denied`: check Graph application permissions and Exchange mailbox scoping.
- Certificate errors: confirm `OUTLOOK_CERT_PATH` points to the public certificate PEM and `OUTLOOK_KEY_PATH` points to the matching private key PEM.
