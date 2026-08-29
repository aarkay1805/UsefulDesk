export interface StoredWhatsAppRegistration {
  phoneNumberId: string | null;
  registeredAt: string | null;
}

export interface EmbeddedRegistrationPlan {
  shouldRegister: boolean;
  registeredAt: string | null;
}

/**
 * Re-running Meta Embedded Signup can return a number that is already live.
 * Calling /register again with a newly generated PIN would replace the known
 * good local state with Meta's PIN-mismatch error, so same-number reconnects
 * preserve the earlier successful registration instead.
 */
export function planEmbeddedRegistration(
  existing: StoredWhatsAppRegistration | null,
  selectedPhoneNumberId: string
): EmbeddedRegistrationPlan {
  const canPreserve =
    existing?.phoneNumberId === selectedPhoneNumberId &&
    Boolean(existing.registeredAt);

  return canPreserve
    ? { shouldRegister: false, registeredAt: existing.registeredAt }
    : { shouldRegister: true, registeredAt: null };
}
