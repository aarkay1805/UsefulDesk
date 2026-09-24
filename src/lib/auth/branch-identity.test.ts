import { describe, expect, it } from 'vitest';

import { registeredBusinessName } from './branch-identity';

describe('registeredBusinessName', () => {
  it('uses the legacy canonical name when the explicit field is absent', () => {
    expect(
      registeredBusinessName({ legal_entity_name: 'Legacy Legal Ltd' })
    ).toBe('Legacy Legal Ltd');
  });

  it('preserves the new schema missing-name state', () => {
    expect(
      registeredBusinessName({
        legal_entity_name: 'Gym display label',
        legal_entity_legal_name: null,
      })
    ).toBeNull();
  });

  it('prefers the explicit registered name over a descriptive label', () => {
    expect(
      registeredBusinessName({
        legal_entity_name: 'Gym display label',
        legal_entity_legal_name: 'Registered Fitness Pvt Ltd',
      })
    ).toBe('Registered Fitness Pvt Ltd');
  });
});
