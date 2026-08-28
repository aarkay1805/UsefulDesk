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
