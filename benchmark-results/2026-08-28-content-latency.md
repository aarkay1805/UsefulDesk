# Production content-latency benchmark — 2026-08-28

## Method

- Production Next.js build served locally on port 3100 against the same authenticated live account and branch data as the earlier controlled benchmark.
- Codex in-app Chromium browser; sidebar transitions measured with `performance.now()` and a `MutationObserver` installed immediately before each click.
- One browser-cache-disabled cold/cache-miss transition per route, followed by ten alternating warm Members and Dashboard transitions with browser cache enabled.
- Dashboard markers distinguish the immediately renderable shell, first completed live section, primary `Today at a glance` section, and all five completed live sections. Members visible rows is recorded only after the renewal loading state was observed and then cleared.
- All durations below are milliseconds. The supplied earlier optimized figures are comparison evidence, not acceptance results.

## Fresh results

| Surface             |                   Marker | Warm median | Warm mean | Warm p90 |                         Cold |
| ------------------- | -----------------------: | ----------: | --------: | -------: | ---------------------------: |
| Combined navigation |         Pending feedback |        24.2 |      24.2 |     31.5 | Members 36.0; Dashboard 26.7 |
| Combined navigation | Route fallback / heading |        28.1 |      27.6 |     34.9 | Members 46.0; Dashboard 30.6 |
| Dashboard           |      Quick-actions shell |       181.2 |     181.0 |    331.7 |                        336.3 |
| Dashboard           |       First live section |       185.1 |     388.9 |    777.5 |                      1,077.6 |
| Dashboard           |        Today at a glance |       185.1 |     766.4 |  1,719.2 |                      2,152.9 |
| Dashboard           |   All five live sections |       185.1 |   1,176.2 |  2,854.7 |                      3,492.2 |
| Members             |     Visible renewal rows |       229.7 |     308.9 |    485.7 |                        697.4 |

Dashboard server-stage timings on the slow streamed requests confirmed that the sections no longer block each other. Across the captured requests, `section.expiringMemberships` completed in 144–373 ms, `section.followUps` in 299–581 ms, `section.uncontactedLeads` in 690–968 ms, `section.gymMetrics` in 1,083–1,416 ms, and `section.attention` in 1,744–2,638 ms. Authentication stages were 145–473 ms for `auth.user` and 248–534 ms for `auth.bootstrap`. Only fixed stage labels, status, and duration were logged.

## Comparison with the prior controlled run

- Pending feedback stayed effectively flat: 24.2 ms fresh median versus 24.5 ms prior.
- Route fallback stayed effectively flat: 28.1 ms fresh median versus 28.5 ms prior.
- Members visible rows improved from a 490 ms prior warm mean to 308.9 ms (36.9% faster), and the cold sample improved from 763 ms to 697.4 ms (8.6% faster).
- Dashboard becomes useful progressively: its cold shell appeared at 336.3 ms and first live section at 1,077.6 ms instead of withholding the page for all five groups. The new primary-section and all-sections markers are intentionally reported separately and are not treated as identical to the earlier single content marker.
- Full Dashboard completion did **not** improve: the fresh warm mean was 1,176.2 ms versus 1,123 ms prior, p90 was 2,854.7 ms versus 2,836 ms, and the cold sample was 3,492.2 ms versus 2,938 ms. No full-completion improvement is claimed; the measured gain is earlier shell/section reveal and isolation of the still-slow `needs-attention` query.

## Raw warm samples

- Members visible rows: 251.9, 183.7, 475.4, 477.1, 175.4, 485.7, 173.7, 207.5, 168.1, 490.7
- Dashboard shell: 30.6, 331.7, 28.2, 334.2, 331.7, 328.8, 29.8, 33.1, 323.9, 38.5
- Dashboard first live section: 30.6, 752.0, 28.2, 1,110.5, 331.7, 777.5, 29.8, 33.1, 757.6, 38.5
- Dashboard Today at a glance: 30.6, 1,657.7, 28.2, 2,098.6, 331.7, 1,697.1, 29.8, 33.1, 1,719.2, 38.5
- Dashboard all five sections: 30.6, 2,584.7, 28.2, 3,072.5, 331.7, 2,854.7, 29.8, 33.1, 2,757.8, 38.5

## Follow-up action-snapshot database evidence

The next bounded slice replaces the maximum 12-request server action stage
(gym metrics 4, follow-ups and preview staff 3, expiring memberships 2,
uncontacted leads 2, attention 1) with one `dashboard_action_snapshot` RPC.
The five former `section.*` timing labels become one identifier-free
`actions.snapshot` stage. This is an 11-request / 91.67% reduction. Existing
server hydration still makes zero initial browser action requests; mutation
refresh still makes one private/no-store request and follow-up filter changes
make none. The earlier historical 14-to-1 browser consolidation is preserved.

The connector-applied function was probed under a real authenticated branch
member with viewer authorization and the selected-branch request header on
both databases. Each returned all five JSON sections with an empty error array;
RLS exposed one contact account and it matched only the requested branch.
Metadata confirmed stable `SECURITY INVOKER`, authenticated execute, and no
anon, service-role, or public execute grant. `EXPLAIN (ANALYZE, BUFFERS, FORMAT
JSON)` returned one `Result` row, zero reads, writes, or temporary blocks, and
completed in 126.660 ms on Production (4,578 shared hits) and 122.191 ms on Test
(4,597 shared hits). Supabase advisors reported zero findings whose metadata or
detail referenced `dashboard_action_snapshot`; existing unrelated project
advisories were not changed or claimed as clean.

## Hosted preview region comparison

Two dirty-working-tree Vercel previews were measured with the same authenticated
account, selected branch, in-app Chromium tab, and ten warm Members-to-Dashboard
sidebar transitions. The first used Vercel's default `iad1` function region;
the second used the repository's explicit `sin1` region beside both Singapore
Supabase projects. These hosted numbers are comparable with each other, not with
the earlier locally served production build above.

| Hosted marker             | `iad1` median | `sin1` median |           Change | `iad1` p90 | `sin1` p90 |
| ------------------------- | ------------: | ------------: | ---------------: | ---------: | ---------: |
| Quick-actions shell       |    3,204.5 ms |    3,203.5 ms | effectively flat |   3,208 ms |   3,212 ms |
| All five action sections  |    4,487.5 ms |    3,203.5 ms |     28.6% faster |   4,824 ms |   3,212 ms |
| Server `auth.user`        |      279.5 ms |         65 ms |     76.7% faster |     364 ms |     134 ms |
| Server `auth.bootstrap`   |      1,404 ms |      127.5 ms |     90.9% faster |   1,680 ms |     181 ms |
| Server `actions.snapshot` |    2,073.5 ms |    1,793.5 ms |     13.5% faster |   2,409 ms |   2,002 ms |

The browser made zero `/api/dashboard/actions` requests during every initial
transition and zero while switching the All/Leads filter in both previews. The
Singapore run's all-action samples were 3,201, 3,211, 3,212, 3,216, 3,200,
3,209, 3,204, 3,203, 3,195, and 3,197 ms. Region placement removed the action
sections' median 1,283 ms catch-up behind the shell, but the snapshot remains
the slowest measured server stage. Its remaining 1.79 s median versus the
122–127 ms direct database plans identifies authenticated PostgREST/RLS RPC
execution as the next bounded investigation; this change does not claim that
work is solved.
