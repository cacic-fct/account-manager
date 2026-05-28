# Account Merge Workflow

Account merging is asynchronous. The user proves ownership of both Keycloak accounts, chooses the primary email, then the backend handles scoring, local merge, and external notifications through BullMQ.

## User-Facing Statuses

- `pending`: the second account was authenticated and the user must choose the primary email.
- `pending_score`: Account Manager is calculating local score and best-effort external scores.
- `pending_merge`: local merge is done and external systems are being notified.
- `completed`: all required work and external acknowledgements completed.
- `failed`, `expired`, `cancelled`: terminal non-success states.

External scoring is optional. If a scoring backend returns an error or does not respond within 30 minutes, Account Manager ignores that backend score and continues with local scoring.

## Frontend/API Flow

1. `POST /auth/account-linking/google/start`
   - Requires the normal user session and CSRF token.
   - Returns `{ "url": "..." }`.
   - The URL logs out the Keycloak SSO session first, then starts Google login for the second account.

2. `GET /auth/account-linking/google/callback`
   - Called by Keycloak.
   - Creates an `account_merge_requests` row with status `pending`.
   - Redirects to:
     `/settings/linked-accounts?accountLink=merge-required&merge_request=<id>`

3. `GET /auth/account-linking/merge-requests/:id`
   - Returns the merge request, email options, selected email, scores when available, and notification summary.

4. `POST /auth/account-linking/merge-requests/:id/confirm`
   - Body:
     ```json
     { "primaryEmail": "user@cacic.dev.br" }
     ```
   - Stores the primary email before scoring starts.
   - Moves status to `pending_score`.
   - Enqueues the BullMQ scoring/local-merge job.

5. Frontend polls `GET /auth/account-linking/merge-requests/:id` while status is `pending_score` or `pending_merge`.

## External Scoring Contract

Configured score backends receive:

```json
{
  "userIds": ["candidate-a", "candidate-b"]
}
```

Expected response:

```json
{
  "scores": {
    "candidate-a": 10,
    "candidate-b": 25
  }
}
```

Alternatively, an array is accepted:

```json
[
  { "userId": "candidate-a", "score": 10 },
  { "userId": "candidate-b", "score": 25 }
]
```

Responses must be HTTP 200. Any non-200, invalid payload, or timeout after 30 minutes is treated as no external score.

## External Merge Notification Contract

After the local merge succeeds, each configured merge backend receives:

```json
{
  "eventId": "uuid",
  "type": "account.merged",
  "oldUserId": "old-id",
  "newUserId": "new-id",
  "occurredAt": "2026-05-08T12:00:00Z"
}
```

The backend must return HTTP 200 with this acknowledgement:

```json
{
  "eventId": "same-uuid",
  "type": "account.merged",
  "oldUserId": "old-id",
  "newUserId": "new-id",
  "status": "success"
}
```

Only this validated response marks that backend as completed. A plain 200 without the acknowledgement is retried.

## Retry Policy

External merge notifications are sent immediately after local merge. If a backend does not return the validated acknowledgement, Account Manager retries only that backend.

Retry delay:

```text
min(10 minutes * attempt^2, 24 hours)
```

Examples:

- first retry: 10 minutes
- second retry: 40 minutes
- third retry: 90 minutes
- ceiling: 24 hours

## BullMQ/Redis

BullMQ uses the existing Redis deployment.

Environment:

```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
```

Docker Compose includes Redis health checks. In production, the backend service sets `REDIS_HOST=redis`.

## External Backend Configuration

```json
ACCOUNT_MERGE_EXTERNAL_BACKENDS=[
  {
    "name": "external-app-a",
    "scoreUrl": "https://external-a.cacic.dev.br/account-merge/score",
    "mergeUrl": "https://external-a.cacic.dev.br/account-merge/merge",
    "audience": "external-app-a"
  }
]
```

All calls use Keycloak client-credentials Bearer tokens. Static API tokens are not supported.
