import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
import HomeStudyPage from './page';
afterEach(() => vi.unstubAllEnvs());
describe('Home study access', () => {
  it('refuses the fictional surface in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => HomeStudyPage()).toThrow('NOT_FOUND');
  });
  it('renders the practice surface in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(HomeStudyPage()).toBeTruthy();
  });
});
