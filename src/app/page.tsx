import { redirect } from 'next/navigation'

// Safety net: if a Supabase auth redirect ever lands on the root
// (e.g. the project Site URL is used as the fallback redirect when
// an emailRedirectTo isn't allowlisted), forward the auth params to
// /auth/callback instead of silently dropping them — a bare
// redirect('/dashboard') strips the query string, losing the
// one-time ?code and leaving the user verified but signed out.
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams

  if (params.code || params.token_hash) {
    const qs = new URLSearchParams()
    for (const key of ['code', 'token_hash', 'type', 'next'] as const) {
      const value = params[key]
      if (typeof value === 'string') qs.set(key, value)
    }
    redirect(`/auth/callback?${qs.toString()}`)
  }

  redirect('/dashboard')
}
