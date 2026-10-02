# Security Policy

## Supported Versions

| Version  | Supported          |
| -------- | ------------------ |
| 3.12.x   | :white_check_mark: |
| < 3.12.0 | :x:                |

Security fixes ship in the latest release only. v3.11.2 and v3.12.0 both
contain security fixes (see [`CHANGELOG.md`](CHANGELOG.md)), so upgrade rather
than staying on an older 3.x build.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately:

1. **Do not** open a public GitHub issue, pull request or Discussion for security vulnerabilities.
2. **Report it through GitHub's private vulnerability reporting:** [**Report a vulnerability**](https://github.com/littlebearapps/outlook-assistant/security/advisories/new) (Security tab → Advisories → Report a vulnerability). This is the preferred channel. Your report, proof-of-concept code and our discussion stay private until a fix ships, and you can be credited on the published advisory.
3. If you can't use GitHub, email [hello@littlebearapps.com](mailto:hello@littlebearapps.com) with a short description and no exploit code. Mail filters may reject messages that contain exploit payloads, and we'll reply with a private channel for the details.
4. Include the affected version, steps to reproduce, and the impact you expect.
5. Allow reasonable time for a fix before public disclosure.

### What to expect

- **Acknowledgement within 7 days.** Private reports are reviewed at least weekly.
- An initial assessment (valid, duplicate or not a vulnerability) within 14 days.
- For confirmed issues, a fix in a patch release and a published GitHub Security Advisory crediting you, unless you'd rather not be named.

## Security Considerations

### Token Storage

- OAuth tokens are stored locally at `~/.outlook-assistant-tokens.json`
- Ensure this file has appropriate permissions (readable only by owner): `chmod 600 ~/.outlook-assistant-tokens.json`
- Never commit token files to version control

### Environment Variables

- Store `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` securely
- Use `.env` files locally (never commit to git)
- Use secure secret management in production

### API Permissions

At sign-in this server requests the following Microsoft Graph delegated permissions:

- `offline_access` — Token refresh
- `User.Read` — Basic profile
- `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` — Email access
- `Calendars.Read`, `Calendars.ReadWrite` — Calendar management
- `Contacts.Read`, `Contacts.ReadWrite` — Contact management
- `MailboxSettings.ReadWrite` — Settings access
- `People.Read` — People search

Opt-in, work/school accounts only:

- `Mail.Read.Shared` — shared mailbox reads, requested only when `OUTLOOK_SHARED_MAILBOX=read` or `true`
- `Mail.ReadWrite.Shared` — shared mailbox organising, requested only when `OUTLOOK_SHARED_MAILBOX=true`
- `Place.Read.All` — meeting room search; not requested by default, add it in Azure with admin consent if you need `find-meeting-rooms`

`Mail.Send.Shared` is never requested. Token refresh asks only for the scopes
recorded as granted at sign-in, plus `offline_access`, so a refresh never
widens access.

Only grant permissions that are necessary for your use case.

## Best Practices

1. Regularly rotate your Azure AD client secret
2. Monitor your Azure AD app for suspicious activity
3. Use the principle of least privilege for permissions
4. Keep dependencies updated (`npm audit`)
5. Review the OAuth scopes and remove any you don't need
6. Configure send-email safety controls (see below) — especially the recipient allowlist
7. Always review AI-initiated tool calls before approving, particularly sends and deletes

## MCP Safety Controls

Outlook Assistant includes multiple layers of safety controls for AI-driven access. These are defence-in-depth measures that reduce risk, but **they are not foolproof**. You should always exercise caution and review actions before approving them.

### Tool Annotations

Every tool carries [MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#annotations) that inform AI clients about the nature of each operation:

| Annotation | Meaning | Effect |
|------------|---------|--------|
| `readOnlyHint: true` | Tool only reads data | MCP clients auto-approve (no prompt) |
| `destructiveHint: true` | Tool can cause irreversible changes | Client prompts for explicit confirmation |
| `idempotentHint: true` | Safe to retry without side effects | Client may auto-retry on failure |

- **7 read-only tools** are auto-approved (search, read, list operations)
- **6 destructive tools** (`send-email`, `draft`, `manage-event`, `manage-contact`, `folders`, `manage-rules`) prompt for confirmation
- **9 other tools** (2 idempotent, 7 moderate-write) follow normal approval flows

See the [Tools Reference](docs/quickrefs/tools-reference.md#safety-annotations) for the full list.

### Send-Email Protections

The `send-email` tool includes additional server-side controls:

| Control | Environment Variable | Default | Description |
|---------|---------------------|---------|-------------|
| Dry-run mode | — (use `dryRun: true` param) | Disabled | Preview composed email without sending |
| Session rate limit | `OUTLOOK_MAX_EMAILS_PER_SESSION` | Unlimited | Maximum emails per server session |
| Recipient allowlist | `OUTLOOK_ALLOWED_RECIPIENTS` | Allow all | Comma-separated domains/addresses |

Example configuration:

```bash
OUTLOOK_MAX_EMAILS_PER_SESSION=5
OUTLOOK_ALLOWED_RECIPIENTS=mycompany.com,partner@example.com
```

### Input and File Hardening

- Caller-supplied IDs can't contain `.` or `..` path segments (literal or
  percent-encoded), so an ID can't redirect a request to a different Graph
  resource.
- Continuation links (`deltaToken`, `nextLink`) must be `https` URLs on
  `graph.microsoft.com`; the access token is never sent anywhere else.
- Attachment downloads and exports write sanitised filenames with exclusive
  create (no overwriting, no following symlinks) and stay inside the chosen
  output directory.
- Shared-mailbox addresses must be printable-ASCII email addresses, and
  shared-mailbox access is off unless `OUTLOOK_SHARED_MAILBOX` is set.

### Limitations

These controls are not a substitute for careful oversight:

- Annotations depend on the AI client respecting them — not all clients support MCP annotations
- Rate limits reset when the MCP server restarts
- The recipient allowlist applies to `send-email`, `draft` (create, update, forward) and `manage-rules` forward/redirect targets — it doesn't cover anything done outside Outlook Assistant
- AI models can still make mistakes in composing email content, selecting recipients, or interpreting instructions
- No automated system can fully prevent prompt injection attacks or adversarial manipulation

**Always review tool calls before approving**, especially for operations that send email, modify calendar events, or delete data.
