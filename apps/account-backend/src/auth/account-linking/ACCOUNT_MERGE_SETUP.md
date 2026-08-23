# Account Merge Workflow

Account merging is asynchronous. The user proves ownership of both Keycloak accounts, chooses the primary email, then the backend handles scoring, local merge, and external notifications through BullMQ.

## User-Facing Statuses

- `pending`: the second account was authenticated and the user must choose the primary email.
- `pending_score`: Account Manager is calculating local score and configured external scores.
- `processing`: Account Manager has claimed the request and is applying the local merge.
- `pending_merge`: local merge is done and external systems are being notified.
- `completed`: local merge completed and every external notification is acknowledged (optional scoring failures are recorded).
- `failed`, `expired`, `cancelled`: terminal non-success states.

External scoring backends are required by default. Set `"required": false` for an optional scorer. If a required scorer returns an error or does not respond within 30 minutes, the request is marked `failed`, the exact degraded reason and backend response are persisted, and no identity or local-data side effects run.

When a merge changes Keycloak, the worker first persists an external-state snapshot and step ledger in `merge_state`. A database failure after an external step triggers compensation from that snapshot; an interrupted worker is recovered by the scheduled repair job. Keycloak and PostgreSQL are intentionally not treated as one transaction.

When the local merge completes, the secondary session is destroyed and the user must sign in again with the primary account so the session principal and all token fields agree.

## Frontend/API Flow

1. `POST /auth/account-linking/google/start`
   - Requires the normal user session and CSRF token.
   - Returns `{ "url": "..." }`.
   - The URL logs out the Keycloak SSO session first, then starts Google login for the second account.

2. `GET /auth/account-linking/google/callback`
   - Called by Keycloak.
   - Creates an `account_merge_requests` row with status `pending`.
   - Redirects to:
     `/settings/linked-accounts/google?accountLink=merge-required&merge_request=<id>`

3. `GET /auth/account-linking/merge-requests/:id`
   - Returns the merge request, email options, selected email, scores when available, and notification summary.

4. `POST /auth/account-linking/merge-requests/:id/confirm`
   - Body:
     ```json
     { "primaryEmail": "user@example.org" }
     ```
   - Stores the primary email before scoring starts.
   - Moves status to `pending_score`.
   - Enqueues the BullMQ scoring/local-merge job.

5. Frontend opens `GET /auth/account-linking/merge-requests/:id/events` as an SSE stream while status is `pending_score`, `processing`, or `pending_merge`. The first event is a full request snapshot; subsequent events are field-level deltas.

## External Scoring Contract

Configured gRPC score backends receive `ScoreAccountMerge` with:

```json
{
  "userIds": ["candidate-a", "candidate-b"]
}
```

The gRPC response contains:

```json
{
  "scores": [
    { "userId": "candidate-a", "score": 10 },
    { "userId": "candidate-b", "score": 25 }
  ]
}
```

Each score is a protobuf `UserScore` item with `userId` and `score`. An unavailable gRPC backend, invalid response, or deadline exceeded after 30 minutes is a degraded result; required backends fail the merge, while optional backends contribute an explicit error record and local scoring continues.

## External Merge Notification Contract

After the local merge succeeds, each configured merge backend receives an `ApplyAccountMerge` gRPC request:

```json
{
  "eventId": "uuid",
  "type": "account.merged",
  "oldUserId": "old-id",
  "newUserId": "new-id",
  "occurredAt": "2026-05-08T12:00:00Z"
}
```

The gRPC response must acknowledge the same event:

```json
{
  "eventId": "same-uuid",
  "type": "account.merged",
  "oldUserId": "old-id",
  "newUserId": "new-id",
  "status": "success"
}
```

Only this validated gRPC response marks that backend as completed. An unavailable, invalid, or failed response is retried up to five attempts; after that the notification becomes terminal `failed` and the merge request becomes terminal `failed` with an administrator-only manual retry endpoint.

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

The fifth failed attempt is terminal. Administrators can retry a failed notification with `POST /admin/account-merges/:id/notifications/:notificationId/retry`; queue failure leaves the notification pending for the recovery cron.

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
ACCOUNT_MERGE_GRPC_BACKENDS=[
  {
    "name": "external-app-a",
    "target": "external-app-a:50051",
    "audience": "external-app-a-audience",
    "required": true
  }
]
```

The `audience` value must match the receiving backend's `KEYCLOAK_M2M_AUDIENCE`. All calls use Keycloak client-credentials Bearer tokens. Static API tokens are not supported.
