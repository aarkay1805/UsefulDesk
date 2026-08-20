// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './button';

afterEach(cleanup);

describe('Button loading state', () => {
  it('keeps its label while exposing progress and blocking repeat activation', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save changes
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.querySelector('.animate-spin')).not.toBeNull();
    expect(button.hasAttribute('loading')).toBe(false);

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not expose progress when loading is false', () => {
    render(<Button loading={false}>Save changes</Button>);

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(button.querySelector('.animate-spin')).toBeNull();
    expect(button.hasAttribute('loading')).toBe(false);
  });
});
