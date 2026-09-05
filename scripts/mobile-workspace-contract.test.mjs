import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

describe('mobile npm workspace', () => {
  it('keeps web at root and registers the Expo app as a workspace', () => {
    const root = readJson('package.json');
    const mobile = readJson('apps/mobile/package.json');

    expect(root.workspaces).toEqual(['apps/*', 'packages/*']);
    expect(root.scripts['mobile:start']).toBe(
      'npm run start --workspace @usefuldesk/mobile'
    );
    expect(root.scripts['mobile:verify']).toBe(
      'npm run verify --workspace @usefuldesk/mobile'
    );
    expect(root.scripts['mobile:test']).toBe(
      'npm run test --workspace @usefuldesk/mobile --'
    );
    expect(root.scripts['mobile:routes']).toBe(
      'npm run routes:generate --workspace @usefuldesk/mobile'
    );
    expect(root.scripts.dev).toBe('next dev');
    expect(mobile.name).toBe('@usefuldesk/mobile');
    expect(mobile.main).toBe('expo-router/entry');
    expect(mobile.scripts.start).toBe(
      'NODE_PATH=./node_modules expo start --dev-client'
    );
    expect(mobile.dependencies.expo).toBe('~57.0.20');
    expect(mobile.dependencies.react).toBe('19.2.3');
    expect(mobile.dependencies['react-native']).toBe('0.86.3');
  });
});
