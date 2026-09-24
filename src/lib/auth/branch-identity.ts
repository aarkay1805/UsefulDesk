/**
 * During rollout, older branch snapshots omit the explicit legal name field.
 * Their legal_entity_name was the canonical name. New snapshots include null
 * when no registered name has been entered.
 */
export function registeredBusinessName(branch: {
  legal_entity_name: string;
  legal_entity_legal_name?: string | null;
}): string | null {
  const name =
    branch.legal_entity_legal_name === undefined
      ? branch.legal_entity_name
      : branch.legal_entity_legal_name;
  return name?.trim() || null;
}
