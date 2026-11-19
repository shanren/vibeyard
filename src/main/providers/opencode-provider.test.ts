import { describe, it, expect, vi } from 'vitest';

vi.mock('../pty-manager', () => ({ getFullPath: () => '/mock/bin:/usr/bin' }));
vi.mock('./resolve-binary', () => ({
  resolveBinary: vi.fn(() => '/mock/bin/opencode'),
  validateBinaryExists: vi.fn(() => true),
}));

import { OpencodeProvider } from './opencode-provider';

describe('OpencodeProvider', () => {
  const provider = new OpencodeProvider();

  it('identifies itself and declares create-or-resume session ids', () => {
    expect(provider.meta.id).toBe('opencode');
    expect(provider.meta.binaryName).toBe('opencode');
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
    expect(provider.buildArgs({ cliSessionId: 'sess-9', isResume: false, extraArgs: '' })).toEqual(['--session', 'sess-9']);
    expect(provider.buildArgs({ cliSessionId: 'sess-9', isResume: true, extraArgs: '' })).toEqual(['--session', 'sess-9']);
  });

  it('falls back to --continue when a resumed session has no id on record', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: true, extraArgs: '' })).toEqual(['--continue']);
  });

  it('passes the prompt through --prompt, not positionally', () => {
    expect(
      provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--auto', initialPrompt: 'explain this' }),
    ).toEqual(['--auto', '--prompt', 'explain this']);
  });

  it('augments PATH and reports no settings to fix', async () => {
    expect(provider.buildEnv('s1', { PATH: '/usr/bin' }).PATH).toBe('/mock/bin:/usr/bin');
    expect(provider.validateSettings()).toEqual({ statusLine: 'missing', hooks: 'missing', hookDetails: {} });
    await expect(provider.getConfig()).resolves.toEqual({ mcpServers: [], agents: [], skills: [], commands: [] });
  });
});
