// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsRail } from './settings-rail';

const scrollIntoView = vi.fn();
const matchMedia = vi.fn();
let desktopMatches = false;
let reducedMotionMatches = false;
let desktopListener: ((event: MediaQueryListEvent) => void) | undefined;

const desktopMediaQuery = {
  get matches() {
    return desktopMatches;
  },
  addEventListener: (
    _type: string,
    listener: (event: MediaQueryListEvent) => void
  ) => {
    desktopListener = listener;
  },
  removeEventListener: (
    _type: string,
    listener: (event: MediaQueryListEvent) => void
  ) => {
    if (desktopListener === listener) desktopListener = undefined;
  },
};

const reducedMotionMediaQuery = {
  get matches() {
    return reducedMotionMatches;
  },
};

function setMedia({ desktop = false, reducedMotion = false } = {}) {
  desktopMatches = desktop;
  reducedMotionMatches = reducedMotion;
  matchMedia.mockImplementation((query: string) =>
    query.includes('min-width') ? desktopMediaQuery : reducedMotionMediaQuery
  );
}

function setDesktopMatch(matches: boolean) {
  desktopMatches = matches;
  act(() => {
    desktopListener?.({ matches } as MediaQueryListEvent);
  });
}

describe('SettingsRail', () => {
  beforeEach(() => {
    scrollIntoView.mockReset();
    matchMedia.mockReset();
    desktopListener = undefined;
    setMedia();
    vi.stubGlobal('matchMedia', matchMedia);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown })
      .scrollIntoView;
  });

  it('positions a deep-linked section immediately on a narrow screen', () => {
    render(<SettingsRail active="reminders" onSelect={() => undefined} />);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
      behavior: 'auto',
    });
  });

  it('smoothly keeps a newly selected section visible without moving focus', () => {
    const { rerender } = render(
      <SettingsRail active="overview" onSelect={() => undefined} />
    );
    scrollIntoView.mockClear();

    const automatedMessages = screen.getByRole('button', {
      name: 'Automated messages',
    });
    automatedMessages.focus();
    rerender(<SettingsRail active="reminders" onSelect={() => undefined} />);

    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
    expect(document.activeElement).toBe(automatedMessages);
  });

  it('uses immediate scrolling for selection changes when motion is reduced', () => {
    setMedia({ reducedMotion: true });
    const { rerender } = render(
      <SettingsRail active="overview" onSelect={() => undefined} />
    );
    scrollIntoView.mockClear();

    rerender(<SettingsRail active="reminders" onSelect={() => undefined} />);

    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
      behavior: 'auto',
    });
  });

  it('does not scroll the vertical desktop rail', () => {
    setMedia({ desktop: true });

    render(<SettingsRail active="reminders" onSelect={() => undefined} />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('positions the current section when the desktop rail becomes horizontal', () => {
    setMedia({ desktop: true });
    render(<SettingsRail active="reminders" onSelect={() => undefined} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    setDesktopMatch(false);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
      behavior: 'auto',
    });
  });

  it('keeps native button focus while requesting a new section', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SettingsRail active="overview" onSelect={onSelect} />);
    const automatedMessages = screen.getByRole('button', {
      name: 'Automated messages',
    });

    automatedMessages.focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('reminders');
    expect(document.activeElement).toBe(automatedMessages);
  });
});
