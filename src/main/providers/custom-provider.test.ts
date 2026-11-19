import { describe, it, expect, vi } from 'vitest';

vi.mock('../pty-manager', () => ({ getFullPath: () => '/mock/bin:/usr/bin' }));

import { CustomProvider, splitCommandLine } from './custom-provider';

describe('splitCommandLine', () => {
  it('splits a bare binary', () => {
    expect(splitCommandLine('pi')).toEqual({ binary: 'pi', args: [] });
  });

  it('keeps leading arguments', () => {
    expect(splitCommandLine('opencode --model fast')).toEqual({ binary: 'opencode', args: ['--model', 'fast'] });
  });

  it('honours quoted paths and collapses extra whitespace', () => {
    expect(splitCommandLine('  "/opt/My Tools/pi"   --flag  ')).toEqual({
      binary: '/opt/My Tools/pi',
      args: ['--flag'],
    });
  });

  it('supports single quotes and empty input', () => {
    expect(splitCommandLine("'C:\\tools\\aider.exe' --yes")).toEqual({ binary: 'C:\\tools\\aider.exe', args: ['--yes'] });
    expect(splitCommandLine('   ')).toEqual({ binary: '', args: [] });
  });
});

describe('CustomProvider', () => {
  const provider = new CustomProvider();

  it('declares every capability off — nothing here can be inferred', () => {
    expect(provider.meta.id).toBe('custom');
    expect(provider.meta.capabilities).toMatchObject({
      sessionResume: false,
      costTracking: false,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
    });
  });

  it('is always offerable: the user supplies the command', () => {
    expect(provider.validatePrerequisites()).toBe(true);
  });

  it('builds the spawn from the session command plus extra args', () => {
    expect(provider.buildSpawn({ command: 'pi --verbose', extraArgs: '--foo bar' })).toEqual({
      binary: 'pi',
      args: ['--verbose', '--foo', 'bar'],
    });
  });

  it('never forwards initialPrompt as an argument', () => {
    expect(provider.buildSpawn({ command: 'pi', extraArgs: '', initialPrompt: 'hello' })).toEqual({
      binary: 'pi',
      args: [],
    });
  });

  it('augments PATH with the provider-resolved one', () => {
    const env = provider.buildEnv('s1', { PATH: '/usr/bin', HOME: '/home/x' });
    expect(env.PATH).toBe('/mock/bin:/usr/bin');
    expect(env.HOME).toBe('/home/x');
  });

  it('has no hooks, no config and no settings to validate', async () => {
    await expect(provider.getConfig()).resolves.toEqual({
      mcpServers: [],
      agents: [],
      skills: [],
      commands: [],
    });
    expect(provider.validateSettings()).toEqual({ statusLine: 'missing', hooks: 'missing', hookDetails: {} });
    expect(provider.getShiftEnterSequence()).toBeNull();
    expect(() => provider.cleanup()).not.toThrow();
  });
});
