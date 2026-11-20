import { describe, it, expect, vi } from 'vitest';


vi.mock('../pty-manager', () => ({ getFullPath: () => '/mock/bin:/usr/bin' }));
vi.mock('./resolve-binary', () => ({
  resolveBinary: vi.fn(() => '/mock/bin/pi'),
  validateBinaryExists: vi.fn(() => true),
}));

import { PiProvider } from './pi-provider';

describe('PiProvider', () => {
  const provider = new PiProvider();

  it('identifies itself and declares create-or-resume session ids', () => {
    expect(provider.meta.id).toBe('pi');
    expect(provider.meta.binaryName).toBe('pi');
    expect(provider.meta.capabilities).toMatchObject({
      sessionResume: true,
      preassignedSessionId: true,
      hookStatus: false,
      contextWindow: false,
      configReading: false,
      pendingPromptTrigger: 'startup-arg',
    });
  });

  it('creates-or-resumes with the id RCode assigned', () => {
    expect(provider.buildArgs({ cliSessionId: 'abc-123', isResume: false, extraArgs: '' })).toEqual([
      '--session-id',
      'abc-123',
    ]);
    expect(provider.buildArgs({ cliSessionId: 'abc-123', isResume: true, extraArgs: '' })).toEqual([
      '--session-id',
      'abc-123',
    ]);
  });

  it('falls back to --continue when a resumed session has no id on record', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: true, extraArgs: '' })).toEqual(['--continue']);
  });

  it('puts extra args then `--` and the positional prompt last', () => {
    expect(
      provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--model sonnet', initialPrompt: 'fix it' }),
    ).toEqual(['--model', 'sonnet', '--', 'fix it']);
  });

  it('augments PATH and reports no settings to fix', async () => {
    expect(provider.buildEnv('s1', { PATH: '/usr/bin' }).PATH).toBe('/mock/bin:/usr/bin');
    expect(provider.validateSettings()).toEqual({ statusLine: 'missing', hooks: 'missing', hookDetails: {} });
    await expect(provider.getConfig()).resolves.toEqual({ mcpServers: [], agents: [], skills: [], commands: [] });
  });
});
