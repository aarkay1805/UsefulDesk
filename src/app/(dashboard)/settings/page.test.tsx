// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams('tab=reminders'),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ locale: { countryCode: 'IN' } }),
}));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ mode: 'light' }) }));
vi.mock('@/components/settings/settings-rail', () => ({
  SettingsRail: ({ onSelect }: { onSelect: (section: 'profile') => void }) => (
    <button onClick={() => onSelect('profile')}>Profile section</button>
  ),
}));
vi.mock('@/components/settings/renewal-reminders-settings', () => ({
  RenewalRemindersSettings: ({
    onUnsavedChangesChange,
  }: {
    onUnsavedChangesChange: (dirty: boolean) => void;
  }) => (
    <button onClick={() => onUnsavedChangesChange(true)}>
      Change schedule
    </button>
  ),
}));

vi.mock('@/components/settings/settings-overview', () => ({
  SettingsOverview: () => null,
}));
vi.mock('@/components/settings/profile-form', () => ({
  ProfileForm: () => null,
}));
vi.mock('@/components/settings/security-panel', () => ({
  SecurityPanel: () => null,
}));
vi.mock('@/components/settings/appearance-panel', () => ({
  AppearancePanel: () => null,
}));
vi.mock('@/components/settings/whatsapp-config', () => ({
  WhatsAppConfig: () => null,
}));
vi.mock('@/components/settings/lead-capture-panel', () => ({
  LeadCapturePanel: () => null,
}));
vi.mock('@/components/settings/template-manager', () => ({
  TemplateManager: () => null,
}));
vi.mock('@/components/settings/fields-and-tags-panel', () => ({
  FieldsAndTagsPanel: () => null,
}));
vi.mock('@/components/settings/plans-settings', () => ({
  PlansSettings: () => null,
}));
vi.mock('@/components/settings/products-services-settings', () => ({
  ProductsServicesSettings: () => null,
}));
vi.mock('@/components/settings/deals-settings', () => ({
  DealsSettings: () => null,
}));
vi.mock('@/components/settings/localization-settings', () => ({
  LocalizationSettings: () => null,
}));
vi.mock('@/components/settings/organization-settings', () => ({
  OrganizationSettings: () => null,
}));
vi.mock('@/components/settings/members-tab', () => ({
  MembersTab: () => null,
}));
vi.mock('@/components/settings/api-keys-settings', () => ({
  ApiKeysSettings: () => null,
}));

const SettingsPage = (await import('./page')).default;

describe('SettingsPage automated-message draft navigation', () => {
  beforeEach(() => {
    navigation.replace.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the current section when the owner declines to discard changes', () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Change schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Profile section' }));

    expect(confirm).toHaveBeenCalledWith(
      'You have unsaved automated-message changes. Leave without saving them?'
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('navigates after the owner confirms discarding changes', () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Change schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Profile section' }));

    expect(navigation.replace).toHaveBeenCalledWith('/settings?tab=profile', {
      scroll: false,
    });
  });
});
