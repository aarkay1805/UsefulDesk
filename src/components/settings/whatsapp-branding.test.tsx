// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WhatsAppMark } from '@/components/brand/provider-mark';
import { SettingsPanelHead } from './settings-panel-head';
import { SettingsRail } from './settings-rail';

describe('WhatsApp settings branding', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  });

  afterEach(cleanup);

  it('uses a grayscale WhatsApp mark on the settings menu item', () => {
    render(<SettingsRail active="whatsapp" onSelect={() => undefined} />);

    const item = screen.getByRole('button', { name: 'WhatsApp' });
    expect(
      within(item).getByTestId('provider-mark-whatsapp').classList
    ).toContain('grayscale');
  });

  it('supports the WhatsApp mark beside the panel heading', () => {
    render(
      <SettingsPanelHead
        title="WhatsApp"
        leading={<WhatsAppMark />}
        description="Connect and monitor the WhatsApp number your team uses."
      />
    );

    expect(
      within(screen.getByRole('heading', { name: 'WhatsApp' })).getByTestId(
        'provider-mark-whatsapp'
      )
    ).toBeTruthy();
  });
});
