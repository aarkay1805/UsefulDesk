# Production backups — operator runbook

UsefulDesk has an active client-side encrypted backup path from Supabase to a
private Cloudflare R2 bucket. The first full production run succeeded on
2026-08-23 and verified both its database and Storage objects in R2. Backups are
**not yet proven recoverable** until the private `age` identity has an offline
copy and a restore drill is completed against a disposable project.

## What runs

The [Production backup workflow](../.github/workflows/production-backup.yml)
runs at 02:00 IST:

- Every night: Supabase roles, schema, and data dumps produced by the pinned
  Supabase CLI.
- Monday IST: a full snapshot of `avatars`, `chat-media`, `flow-media`, and
  `payment-receipts`, including a per-object SHA-256 manifest.
- On demand: the same database backup, with an option to include Storage. Run
  this immediately before and after a high-risk member import or migration.

`member-import-drafts` is deliberately excluded. It is temporary, author-private
working data with its own 30-day cleanup, not durable customer data.

The runner creates plaintext only in an isolated temporary directory. It
archives and encrypts each backup with `age` before uploading it, verifies the
remote R2 object size with `HeadObject`, and removes the temporary directory on
success or failure. GitHub artifacts are not used. R2 receives only `.age`
archives and their SHA-256 files.

This gives the one-gym pilot a database recovery point of at most 24 hours and
a media recovery point of at most seven days. It is not point-in-time recovery;
Supabase Pro remains the upgrade path when shorter recovery objectives are
needed.

## One-time setup

### 1. Create the R2 destination

In Cloudflare:

1. Create a private R2 bucket, for example `usefuldesk-backups`. Do not attach a
   public development URL or custom domain.
2. Under **Manage R2 API Tokens**, create an **Object Read & Write** token scoped
   only to that bucket. Record its Access Key ID and Secret Access Key when
   shown.
3. Add an object lifecycle rule that expires all objects after 35 days. Apply it
   to the whole bucket so archives and checksum files expire together. Keeping
   the bucket on Standard storage avoids the retrieval charges and minimum
   duration associated with Infrequent Access.

The workflow uses Cloudflare's S3 endpoint:
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

### 2. Generate the encryption identity

Run this only on a trusted local machine:

```bash
brew install age
age-keygen -o usefuldesk-backup-identity.txt
```

The command prints a public recipient beginning with `age1`. The recipient is
safe to give GitHub. The identity file contains the private key: put it in the
owner's password manager and one separate offline copy, then remove the loose
local file. Never add it to Git, GitHub, Cloudflare, Vercel, or Supabase. Without
that private key, the backups cannot be decrypted.

### 3. Configure GitHub Actions

In **GitHub → Settings → Secrets and variables → Actions**, add:

| Kind     | Name                        | Value                                                        |
| -------- | --------------------------- | ------------------------------------------------------------ |
| Variable | `SUPABASE_PROJECT_REF`      | Project reference from the Supabase URL                      |
| Variable | `R2_ACCOUNT_ID`             | Cloudflare account ID                                        |
| Variable | `R2_BUCKET_NAME`            | The private bucket name                                      |
| Variable | `BACKUP_AGE_RECIPIENT`      | Public `age1...` recipient                                   |
| Secret   | `SUPABASE_DB_PASSWORD`      | Production Postgres database password                        |
| Secret   | `SUPABASE_SERVICE_ROLE_KEY` | Production service-role key used to read the private buckets |
| Secret   | `R2_ACCESS_KEY_ID`          | Bucket-scoped R2 token access-key ID                         |
| Secret   | `R2_SECRET_ACCESS_KEY`      | Bucket-scoped R2 token secret                                |

The workflow passes `SUPABASE_DB_PASSWORD` to the Supabase CLI and identifies
the database with `SUPABASE_PROJECT_REF`. This avoids storing a composed
connection URL or percent-encoding the password.

### 4. Activate and prove it

Activation record: GitHub Actions run
[`32631148522`](https://github.com/aarkay1805/UsefulDesk/actions/runs/32631148522)
succeeded on 2026-08-23. It verified the encrypted database archive and a
551,754-byte Storage snapshot containing six objects across the four durable
buckets. The restore drill remains pending.

1. Open **Actions → Production backup → Run workflow** on `main`.
2. Leave **Include Storage** enabled for the first run.
3. Confirm the job is green and R2 contains both `database/YYYY/MM/` and
   `storage/YYYY/MM/` objects with matching `.sha256` files.
4. Perform the restore drill below. Record the date and destination project in
   the operating log.

A configured schedule is not proof of recovery. Do not call backups operational
until this first run and restore drill have passed. Treat a failed scheduled run
as an operational alert: inspect the Action that day, correct the failing
credential/quota/export, then rerun it manually.

## Restore drill

Always restore into a disposable Supabase project first. Restoring onto
production is destructive and requires separate, explicit authorization.

### 1. Download and decrypt

With the Cloudflare credentials exported as the standard AWS variables:

```bash
export AWS_ACCESS_KEY_ID='<R2 access key id>'
export AWS_SECRET_ACCESS_KEY='<R2 secret access key>'
export AWS_DEFAULT_REGION='auto'

aws s3 cp \
  's3://usefuldesk-backups/database/YYYY/MM/database-TIMESTAMP.tar.gz.age' . \
  --endpoint-url 'https://ACCOUNT_ID.r2.cloudflarestorage.com'
aws s3 cp \
  's3://usefuldesk-backups/database/YYYY/MM/database-TIMESTAMP.tar.gz.age.sha256' . \
  --endpoint-url 'https://ACCOUNT_ID.r2.cloudflarestorage.com'
sha256sum --check database-TIMESTAMP.tar.gz.age.sha256
age --decrypt \
  --identity /secure/path/usefuldesk-backup-identity.txt \
  --output database-TIMESTAMP.tar.gz \
  database-TIMESTAMP.tar.gz.age
mkdir database-restore
tar -C database-restore -xzf database-TIMESTAMP.tar.gz
(cd database-restore && sha256sum --check SHA256SUMS)
```

Use `shasum -a 256 -c` instead of `sha256sum --check` on macOS if GNU
coreutils is not installed.

### 2. Restore the database

Point `RESTORE_DATABASE_URL` only at the disposable destination and review the
archive's `BACKUP-METADATA` first:

```bash
psql "$RESTORE_DATABASE_URL" \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file database-restore/roles.sql \
  --file database-restore/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file database-restore/data.sql
```

Provider-managed roles or extensions can need destination-specific handling.
Stop on the first error; do not weaken constraints or edit production to make a
drill pass. Record the exact correction in this runbook before retrying.

### 3. Restore and verify Storage

Download, verify, decrypt, and extract the matching Storage archive the same
way. Its `manifest.json` maps every local file under
`objects/<bucket>/<object-path>` to its byte count and SHA-256. Restore every
object with the repository helper, which verifies the archived byte count and
SHA-256 before upload, preserves the manifest MIME type and cache control, then
downloads and hashes every restored object again:

```bash
RESTORE_SUPABASE_URL='https://DISPOSABLE_PROJECT_REF.supabase.co' \
RESTORE_SUPABASE_SERVICE_ROLE_KEY='<disposable-project service-role key>' \
node scripts/restore-supabase-storage.mjs storage-restore
```

The helper uses `upsert: true` intentionally because restored database metadata
can already contain the object rows. It accepts both the original version 1
manifest and the metadata-preserving version 2 manifest.

Finally verify, at minimum:

- Auth users can sign in and belong to the expected account.
- Account, branch, member, membership, invoice, payment, attendance, and contact
  counts match the source snapshot.
- A payment receipt can be opened through a newly generated signed URL.
- An avatar/chat/flow object from each non-empty backed-up bucket downloads and
  matches its manifest hash.
- RLS prevents one disposable tenant from reading another tenant's records.

Delete the disposable project only after recording the drill result. Rotate an
R2 token immediately if it is exposed. If the `age` private identity is exposed,
create a new identity, update `BACKUP_AGE_RECIPIENT`, run a new full backup, and
expire the old archives after the retention requirement is satisfied.

## Capacity watch

R2's free tier can cover an early pilot, but it is not an unlimited backup
service. Each weekly full Storage snapshot also consumes Supabase Storage
egress. Check R2 stored bytes and Supabase egress monthly; shorten retention or
upgrade before either service limit becomes a backup failure.
