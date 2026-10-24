# User schema and onboarding

`isOnboarded` remains the shared Keycloak boolean consumed by every project.
Other projects do not need to track or compare schema versions.

Account Manager stores `userSchemaVersion` alongside it: the schema version last
completed through a validated profile save. Both attributes must be writable only
by administrators. The development realm uses the `ADMIN_EDIT` unmanaged
attribute policy; production must either use that policy or explicitly define
these attributes with administrator-only edit permissions.

The policy lives in
`apps/account-backend/src/auth/services/user-schema.ts`:

- Increment `CURRENT_USER_SCHEMA_VERSION` for a user schema change.
- For optional fields or compatible changes, leave
  `REQUIRED_ONBOARDING_SCHEMA_VERSION` unchanged. Previously completed users keep
  `isOnboarded=true`, even if their recorded version is below the current version.
- When users must complement or review their data, set
  `REQUIRED_ONBOARDING_SCHEMA_VERSION` to the new current version. Update profile
  validation, missing-field detection, and the profile form as appropriate.
  Keep both versions monotonic, with the required version at most the current one.

The backend queues a scan of every Keycloak user on application startup and every
five minutes using BullMQ Job Schedulers. It resets `isOnboarded` to `false` when the recorded version is below the
required threshold or required fields are missing. Users do not have to visit
Account Manager. Failed writes and failed scans fail the job for a BullMQ retry;
subsequent sweeps also recover outstanding work. Startup enqueueing is deduplicated
across replicas, and Redis limits maintenance execution to one active job.
Machine accounts are excluded. A sweep uses unfiltered pages so changing the flag
does not remove users from the result set and skip subsequent pages.

Profile reads and onboarding checks also reconcile the shared boolean immediately.
Successful profile validation saves the current version and `isOnboarded=true`
together. Background reconciliation never marks users complete or advances their
recorded version. A false flag remains false until profile completion.

Missing or malformed versions count as version zero. The initial required threshold
is zero because adding version tracking does not itself require users to supply
new data. Completed legacy profiles keep their flag if required fields are present,
without being stamped as having completed version one. Newly created and cleared
profiles also start at zero, with a false flag. The first mandatory revision must
advance the required threshold to its current version; the sweep then resets all
older profiles, including unversioned ones.
Versions newer than this backend's required threshold are accepted, preventing an
older deployment from resetting users who already completed a newer schema.

The sweep updates stored Keycloak attributes. Tokens already issued by Keycloak
retain their existing claims until refreshed or replaced; consuming projects must
continue their normal token refresh or live-status checks. Reconciliation shares
the existing per-user write queue with profile updates within each backend
instance and writes only the flag and timestamp, preserving unrelated attributes.
