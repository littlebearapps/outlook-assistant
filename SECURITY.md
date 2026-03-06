# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.x.x   | :white_check_mark: |
| 2.x.x   | :white_check_mark: |
| 1.x.x   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email [hello@littlebearapps.com](mailto:hello@littlebearapps.com) with details of the vulnerability
3. Include steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

## Security Considerations

### Token Storage

- OAuth tokens are stored locally at `~/.outlook-mcp-tokens.json`
- Ensure this file has appropriate permissions (readable only by owner): `chmod 600 ~/.outlook-mcp-tokens.json`
- Never commit token files to version control

### Environment Variables

- Store `OUTLOOK_CLIENT_ID` and `OUTLOOK_CLIENT_SECRET` securely
- Use `.env` files locally (never commit to git)
- Use secure secret management in production

### API Permissions

This server requests the following Microsoft Graph delegated permissions:

- `offline_access` — Token refresh
- `User.Read` — Basic profile
- `Mail.Read`, `Mail.ReadWrite`, `Mail.Send` — Email access
- `Mail.Read.Shared` — Shared mailbox access
- `Calendars.Read`, `Calendars.ReadWrite` — Calendar management
- `Contacts.Read`, `Contacts.ReadWrite` — Contact management
- `MailboxSettings.Read`, `MailboxSettings.ReadWrite` — Settings access
- `People.Read` — People search
- `Place.Read.All` — Meeting room search

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

- **6 read-only tools** are auto-approved (search, read, list operations)
- **2 destructive tools** (`send-email`, `manage-event`) always prompt for confirmation
- **12 moderate-write tools** follow normal approval flows

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

### Limitations

These controls are not a substitute for careful oversight:

- Annotations depend on the AI client respecting them — not all clients support MCP annotations
- Rate limits reset when the MCP server restarts
- The recipient allowlist only applies to the `send-email` tool — it does not prevent forwarding or replying via other means
- AI models can still make mistakes in composing email content, selecting recipients, or interpreting instructions
- No automated system can fully prevent prompt injection attacks or adversarial manipulation

**Always review tool calls before approving**, especially for operations that send email, modify calendar events, or delete data.
