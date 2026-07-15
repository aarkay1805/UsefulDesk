// ============================================================
// /data-deletion  — public data-deletion status + instructions page
//
// This is the `url` returned by the Meta Data Deletion Request
// Callback (src/app/api/meta/data-deletion/route.ts). A user who was
// handed a confirmation code lands here (…/data-deletion?code=…) and
// sees the status of their request. With no code it renders general
// instructions for requesting deletion — the "Data Deletion
// Instructions URL" Meta also accepts.
//
// Unauthenticated by design: the confirmation code is the capability.
// Reads with the service role (RLS denies anon on this table).
// ============================================================

import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type RequestRow = {
  status: 'received' | 'processing' | 'completed'
  source: 'meta_callback' | 'account_erasure'
  requested_at: string
  completed_at: string | null
}

const STATUS_COPY: Record<RequestRow['status'], string> = {
  received: 'Received — your request is queued.',
  processing: 'In progress — we are deleting the associated data.',
  completed: 'Completed — the associated data has been deleted.',
}

async function lookupRequest(code: string): Promise<RequestRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null

  const admin = createAdminClient(url, key, {
    auth: { persistSession: false },
  })
  const { data } = await admin
    .from('data_deletion_requests')
    .select('status, source, requested_at, completed_at')
    .eq('confirmation_code', code)
    .maybeSingle()

  return (data as RequestRow | null) ?? null
}

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const { code } = await searchParams
  const request = code ? await lookupRequest(code) : null

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Data deletion request
      </h1>

      {code ? (
        request ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Confirmation code</p>
            <p className="font-mono text-sm break-all">{code}</p>
            <p className="mt-4 text-sm text-muted-foreground">Status</p>
            <p className="text-base font-medium">
              {STATUS_COPY[request.status]}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Requested {new Date(request.requested_at).toUTCString()}
              {request.completed_at
                ? ` · Completed ${new Date(request.completed_at).toUTCString()}`
                : ''}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="text-base font-medium">
              We couldn&apos;t find a request with that confirmation code.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Double-check the link you were given, or use the instructions
              below to submit a new request.
            </p>
          </div>
        )
      ) : null}

      <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-base font-medium text-foreground">
          How to request deletion of your data
        </h2>
        <p>
          This service is a WhatsApp CRM for gyms. We use Facebook Login only
          to connect the WhatsApp Business Account or Facebook Page that a
          business administers; we do not store your Facebook profile.
        </p>
        <p>
          If you are a gym account owner, you can permanently delete your
          account and all of its stored data at any time from{' '}
          <span className="font-medium text-foreground">
            Settings → Account → Delete account
          </span>
          . This erases every contact, conversation, message, and connected
          WhatsApp credential.
        </p>
        <p>
          For any other deletion request, email{' '}
          <a
            href="mailto:contact@usefulmade.com"
            className="font-medium text-foreground underline"
          >
            contact@usefulmade.com
          </a>{' '}
          and we will process it and confirm once complete.
        </p>
      </section>
    </main>
  )
}
