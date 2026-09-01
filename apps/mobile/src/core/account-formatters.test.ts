import { accountFormatters } from './account-formatters';

const account = {
  id: 'd3648c54-a4aa-4dd8-8566-1e3b38c1f497',
  name: 'Indiranagar',
  created_at: '2026-08-01T10:00:00.000Z',
  default_currency: 'INR',
  country_code: 'IN',
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  date_order: 'DMY',
  time_format: '12h',
  week_start: 1,
  phone_country_code: '+91',
  measurement_system: 'metric',
  onboarding_dismissed_at: null,
  organization_id: '405ea376-0d27-4898-b198-0edb2a87ff38',
  legal_entity_id: '895fd4ad-7219-4982-b8e4-a0c84f83e8d4',
  branch_status: 'active',
  readiness_state: 'ready',
  setup_reviewed_at: null,
  setup_reviewed_by: null,
} as const;

it('formats Inbox timestamps and phones with the selected account locale', () => {
  const fmt = accountFormatters(account);
  expect(fmt.time('2026-09-01T15:30:00.000Z')).toBe('9:00 pm');
  expect(fmt.date('2026-09-01T15:30:00.000Z')).toBe('1 Sept 2026');
  expect(fmt.phone('9876543210')).toBe('+919876543210');
});
