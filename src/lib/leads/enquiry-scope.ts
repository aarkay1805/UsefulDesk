interface EnquiryQuery<Q> {
  is(column: string, value: null): Q;
}

/**
 * An enquiry is a contact with neither a membership nor a service purchase
 * (docs/gym-domain.md); a service-only customer belongs in Members → All
 * members. SQL reads apply the same two NOT EXISTS checks (migration
 * 20260927130000_enquiry_reads_exclude_service_customers.sql).
 *
 * Client reads express each check as a PostgREST anti-join: the select embeds
 * the relation, then `<relation> IS NULL` keeps contacts with no such row.
 * Both embeds must be present in every select using {@link onlyEnquiries},
 * including head-count and id-only queries.
 */
export function selectForEnquiries<Columns extends string>(
  select: Columns
): `${Columns}, memberships!left(id), member_services!left(id)` {
  return `${select}, memberships!left(id), member_services!left(id)`;
}

/**
 * Filter on the embeds themselves: `memberships.id IS NULL` would only trim
 * the embedded rows and keep every contact.
 */
export function onlyEnquiries<Q extends EnquiryQuery<Q>>(query: Q): Q {
  return query.is('memberships', null).is('member_services', null);
}
