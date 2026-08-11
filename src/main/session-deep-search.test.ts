import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import type { ProviderId } from '../shared/types';

vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
  },
}));

const providersForTest: CliProvider[] = [];
vi.mock('./providers/registry', () => ({
  getAllProviders: () => providersForTest,
}));

import * as fs from 'fs';
import { projectTranscripts, searchSessions, _resetForTesting } from './session-deep-search';

const mockStat = vi.mocked(fs.promises.stat);

function makeStat(mtime: number): Awaited<ReturnType<typeof fs.promises.stat>> {
  return { mtimeMs: mtime } as Awaited<ReturnType<typeof fs.promises.stat>>;
}

interface FakeProviderOpts {
  id: ProviderId;
  descriptors?: TranscriptDescriptor[];
  index?: Record<string, { text: string; cwd: string }>;
  discoverThrows?: boolean;
  omitDiscover?: boolean;
  omitIndex?: boolean;
}

function fakeProvider(opts: FakeProviderOpts): CliProvider {
  const provider: Partial<CliProvider> = {
    meta: { id: opts.id, displayName: opts.id, binaryName: opts.id, capabilities: {} as any, defaultContextWindowSize: 0 },
  };
  if (!opts.omitDiscover) {
    provider.discoverTranscripts = async () => {
      if (opts.discoverThrows) throw new Error('boom');
      return opts.descriptors ?? [];
    };
  }
  if (!opts.omitIndex) {
    provider.indexTranscript = async (p: string) => opts.index?.[p] ?? { text: '', cwd: '' };
  }
  return provider as CliProvider;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
  providersForTest.length = 0;
});

describe('searchSessions()', () => {
  it('returns empty when no providers are registered', async () => {
    expect(await searchSessions('hello')).toEqual([]);
  });

  it('returns empty when no providers implement discover/index', async () => {
    providersForTest.push(fakeProvider({ id: 'claude', omitDiscover: true }));
    providersForTest.push(fakeProvider({ id: 'codex', omitIndex: true }));
    expect(await searchSessions('hello')).toEqual([]);
  });

  it('skips providers whose discoverTranscripts throws', async () => {
    providersForTest.push(fakeProvider({ id: 'claude', discoverThrows: true }));
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'cx', transcriptPath: '/tx', projectCwd: '/p' }],
      index: { '/tx': { text: 'find me', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('find me');
    expect(results).toHaveLength(1);
    expect(results[0].providerId).toBe('codex');
  });

  it('stamps providerId on each result and sorts merged hits by score desc', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'cl-1', transcriptPath: '/cl-1', projectSlug: 'cl-slug' }],
      index: { '/cl-1': { text: 'only deploy here nothing else', cwd: '/a' } }, // partial → 25
    }));
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'cx-1', transcriptPath: '/cx-1', projectCwd: '/b' }],
      index: { '/cx-1': { text: 'deploy kubernetes cluster', cwd: '' } }, // exact → 100
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('deploy kubernetes');
    expect(results.map(r => r.providerId)).toEqual(['codex', 'claude']);
    expect(results[0].score).toBe(100);
    expect(results[0].cliSessionId).toBe('cx-1');
    expect(results[0].projectCwd).toBe('/b');
    expect(results[1].score).toBe(25);
    expect(results[1].projectCwd).toBe('/a');
    expect(results[1].projectSlug).toBe('cl-slug');
  });

  it('prefers descriptor.projectCwd over indexed cwd when both present', async () => {
    providersForTest.push(fakeProvider({
      id: 'gemini',
      descriptors: [{ cliSessionId: 'g1', transcriptPath: '/g', projectCwd: '/from-descriptor' }],
      index: { '/g': { text: 'searchable hit', cwd: '/from-index' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('searchable hit');
    expect(results[0].projectCwd).toBe('/from-descriptor');
  });

  it('falls back to indexed cwd when descriptor has none', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'c1', transcriptPath: '/c' }],
      index: { '/c': { text: 'searchable hit', cwd: '/from-index' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('searchable hit');
    expect(results[0].projectCwd).toBe('/from-index');
  });

  it('caps results at 20 across all providers', async () => {
    const desc = (i: number): TranscriptDescriptor => ({ cliSessionId: `s${i}`, transcriptPath: `/p${i}` });
    const idx: Record<string, { text: string; cwd: string }> = {};
    const descsA: TranscriptDescriptor[] = [];
    const descsB: TranscriptDescriptor[] = [];
    for (let i = 0; i < 15; i++) {
      descsA.push(desc(i));
      idx[`/p${i}`] = { text: 'find me please', cwd: '' };
    }
    for (let i = 15; i < 30; i++) {
      descsB.push(desc(i));
      idx[`/p${i}`] = { text: 'find me please', cwd: '' };
    }
    providersForTest.push(fakeProvider({ id: 'claude', descriptors: descsA, index: idx }));
    providersForTest.push(fakeProvider({ id: 'codex', descriptors: descsB, index: idx }));
    mockStat.mockResolvedValue(makeStat(1));
    expect(await searchSessions('find me')).toHaveLength(20);
  });

  it('dedupes by (providerId, cliSessionId), keeping the highest-scoring hit', async () => {
    // Same Claude session indexed under two project slugs — both transcripts contain
    // the query but with different match strength. Only the higher-scoring one survives.
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'dup', transcriptPath: '/slug-a/dup.jsonl', projectSlug: 'slug-a', projectCwd: '/a' },
        { cliSessionId: 'dup', transcriptPath: '/slug-b/dup.jsonl', projectSlug: 'slug-b', projectCwd: '/b' },
        { cliSessionId: 'unique', transcriptPath: '/slug-a/unique.jsonl', projectSlug: 'slug-a', projectCwd: '/a' },
      ],
      index: {
        '/slug-a/dup.jsonl': { text: 'deploy kubernetes cluster', cwd: '/a' }, // exact → 100
        '/slug-b/dup.jsonl': { text: 'only deploy here nothing else', cwd: '/b' }, // partial → 25
        '/slug-a/unique.jsonl': { text: 'deploy kubernetes cluster', cwd: '/a' }, // exact → 100
      },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('deploy kubernetes');
    expect(results).toHaveLength(2);
    const dup = results.find(r => r.cliSessionId === 'dup');
    expect(dup).toBeDefined();
    expect(dup!.score).toBe(100);
    expect(dup!.projectSlug).toBe('slug-a');
  });

  it('keeps separate entries when different providers report the same cliSessionId', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'shared-uuid', transcriptPath: '/cl', projectCwd: '/cl' }],
      index: { '/cl': { text: 'find me', cwd: '/cl' } },
    }));
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'shared-uuid', transcriptPath: '/cx', projectCwd: '/cx' }],
      index: { '/cx': { text: 'find me', cwd: '/cx' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('find me');
    expect(results).toHaveLength(2);
    expect(new Set(results.map(r => r.providerId))).toEqual(new Set(['claude', 'codex']));
  });

  it('derives a name from the first transcript segment', async () => {
    const text = 'fix duplicate search rows in the palette\n---\nfollow-up message about something else with the find me query';
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'd1', transcriptPath: '/d1' }],
      index: { '/d1': { text, cwd: '/repo' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('find me');
    expect(results[0].derivedName).toBe('fix duplicate search rows in the palette');
  });

  it('truncates long derived names with an ellipsis', async () => {
    const longLine = 'a'.repeat(200);
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'd2', transcriptPath: '/d2' }],
      index: { '/d2': { text: longLine + '\nfind me\n---\nmore', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('find me');
    expect(results[0].derivedName).toMatch(/…$/);
    expect(results[0].derivedName!.length).toBeLessThanOrEqual(80);
  });

  it('caches indexed text by mtime and avoids re-indexing on second search', async () => {
    const indexSpy = vi.fn(async () => ({ text: 'cached body content', cwd: '/x' }));
    const provider: CliProvider = {
      meta: { id: 'claude', displayName: 'c', binaryName: 'c', capabilities: {} as any, defaultContextWindowSize: 0 },
      discoverTranscripts: async () => [{ cliSessionId: 'a', transcriptPath: '/a' }],
      indexTranscript: indexSpy,
    } as CliProvider;
    providersForTest.push(provider);
    mockStat.mockResolvedValue(makeStat(42));

    await searchSessions('cached body');
    await searchSessions('cached body');
    expect(indexSpy).toHaveBeenCalledTimes(1);
  });

  it('re-indexes when mtime changes', async () => {
    const indexSpy = vi.fn(async () => ({ text: 'updated body content', cwd: '/x' }));
    const provider: CliProvider = {
      meta: { id: 'claude', displayName: 'c', binaryName: 'c', capabilities: {} as any, defaultContextWindowSize: 0 },
      discoverTranscripts: async () => [{ cliSessionId: 'a', transcriptPath: '/a' }],
      indexTranscript: indexSpy,
    } as CliProvider;
    providersForTest.push(provider);
    mockStat
      .mockResolvedValueOnce(makeStat(100))
      .mockResolvedValueOnce(makeStat(200));
    await searchSessions('updated body');
    await searchSessions('updated body');
    expect(indexSpy).toHaveBeenCalledTimes(2);
  });

  it('drops zero-score sessions', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }],
      index: { '/a': { text: 'completely unrelated content', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    expect(await searchSessions('zzz qqq')).toEqual([]);
  });

  it('snippet includes context around the match', async () => {
    const content = 'A'.repeat(70) + 'needle' + 'B'.repeat(70);
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }],
      index: { '/a': { text: content, cwd: '/repo' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('needle');
    expect(results[0].snippet).toContain('needle');
    expect(results[0].snippet).toMatch(/…/);
  });

  it('gibberish query returns no results', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }],
      index: { '/a': { text: 'please add some documentation and cover all cases very well', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    expect(await searchSessions('asdcv')).toEqual([]);
  });
});

describe('projectTranscripts()', () => {
  it('matches Claude transcripts by the slugified project path', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'c1', transcriptPath: '/-repo-my-project/c1.jsonl', projectSlug: '-repo-My-Project' },
        { cliSessionId: 'c2', transcriptPath: '/-other/c2.jsonl', projectSlug: '-other' },
      ],
      index: {
        '/-repo-my-project/c1.jsonl': { text: 'refactor the store', cwd: '/repo/My Project' },
        '/-other/c2.jsonl': { text: 'unrelated', cwd: '/other' },
      },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await projectTranscripts('/repo/My Project');
    expect(results).toHaveLength(1);
    expect(results[0].cliSessionId).toBe('c1');
    expect(results[0].name).toBe('refactor the store');
    expect(results[0].providerId).toBe('claude');
  });

  it('matches transcripts recorded under a different path casing (Windows)', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'c1', transcriptPath: '/e--workspace-vibeyard/c1.jsonl', projectSlug: 'e--workspace-vibeyard' }],
      index: { '/e--workspace-vibeyard/c1.jsonl': { text: 'package the app', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await projectTranscripts('E:\\workspace\\vibeyard');
    expect(results).toHaveLength(1);
    expect(results[0].cliSessionId).toBe('c1');
  });

  it('matches Copilot/Gemini transcripts by projectCwd, normalizing separators and trailing slashes', async () => {
    providersForTest.push(fakeProvider({
      id: 'copilot',
      descriptors: [
        { cliSessionId: 'cp1', transcriptPath: '/cp1/events.jsonl', projectCwd: 'C:\\Users\\me\\repo\\' },
        { cliSessionId: 'cp2', transcriptPath: '/cp2/events.jsonl', projectCwd: 'C:\\Users\\me\\other' },
      ],
      index: {
        '/cp1/events.jsonl': { text: 'copilot fix', cwd: '' },
        '/cp2/events.jsonl': { text: 'copilot other', cwd: '' },
      },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await projectTranscripts('C:/Users/me/repo');
    expect(results).toHaveLength(1);
    expect(results[0].cliSessionId).toBe('cp1');
  });

  it('skips Codex transcripts (no project slug or cwd recorded)', async () => {
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'cx1', transcriptPath: '/2026/08/01/rollout-cx1.jsonl' }],
      index: { '/2026/08/01/rollout-cx1.jsonl': { text: 'codex change', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    expect(await projectTranscripts('/repo')).toEqual([]);
  });

  it('falls back to a truncated cliSessionId when the transcript has no user text', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: '12345678-abcd-ef00-0000-000000000000', transcriptPath: '/-repo/a.jsonl', projectSlug: '-repo' }],
      index: { '/-repo/a.jsonl': { text: '', cwd: '/repo' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await projectTranscripts('/repo');
    expect(results[0].name).toBe('12345678…');
  });

  it('dedupes the same cliSessionId across roots (default + profile), keeping the newest transcript', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'dup', transcriptPath: '/default/-repo/dup.jsonl', projectSlug: '-repo' },
        { cliSessionId: 'dup', transcriptPath: '/profile/-repo/dup.jsonl', projectSlug: '-repo', profileId: 'work' },
      ],
      index: {
        '/default/-repo/dup.jsonl': { text: 'older copy', cwd: '' },
        '/profile/-repo/dup.jsonl': { text: 'newer copy', cwd: '' },
      },
    }));
    mockStat.mockImplementation((p) => {
      if (String(p) === '/profile/-repo/dup.jsonl') return Promise.resolve(makeStat(200));
      return Promise.resolve(makeStat(100));
    });

    const results = await projectTranscripts('/repo');
    expect(results).toHaveLength(1);
    expect(results[0].transcriptPath).toBe('/profile/-repo/dup.jsonl');
    expect(results[0].profileId).toBe('work');
  });

  it('prefers projectCwd when a provider also sets a non-path projectSlug (Gemini)', async () => {
    providersForTest.push(fakeProvider({
      id: 'gemini',
      descriptors: [
        { cliSessionId: 'g1', transcriptPath: '/gem/tmp/k1/g1.jsonl', projectSlug: 'k1-project-key-hash', projectCwd: '/repo' },
        { cliSessionId: 'g2', transcriptPath: '/gem/tmp/k2/g2.jsonl', projectSlug: 'k2-project-key-hash', projectCwd: '/other' },
      ],
      index: {
        '/gem/tmp/k1/g1.jsonl': { text: 'gemini change', cwd: '/repo' },
        '/gem/tmp/k2/g2.jsonl': { text: 'gemini other', cwd: '/other' },
      },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await projectTranscripts('/repo');
    expect(results).toHaveLength(1);
    expect(results[0].cliSessionId).toBe('g1');
  });

  it('caps indexing to the newest MAX_PROJECT_TRANSCRIPTS transcripts', async () => {
    const descriptors: TranscriptDescriptor[] = [];
    const index: Record<string, { text: string; cwd: string }> = {};
    const indexSpy = vi.fn(async (p: string) => index[String(p)] ?? { text: 'project work', cwd: '' });
    for (let i = 0; i < 120; i++) {
      descriptors.push({ cliSessionId: `s${i}`, transcriptPath: `/-repo/s${i}.jsonl`, projectSlug: '-repo' });
    }
    const provider: CliProvider = {
      meta: { id: 'claude', displayName: 'c', binaryName: 'c', capabilities: {} as any, defaultContextWindowSize: 0 },
      discoverTranscripts: async () => descriptors,
      indexTranscript: indexSpy,
    } as CliProvider;
    providersForTest.push(provider);
    // newest ids (119..20) get the highest mtimes → they win the cap slice.
    mockStat.mockImplementation((p) => {
      const m = /\/-repo\/s(\d+)\.jsonl/.exec(String(p));
      return Promise.resolve(makeStat(m ? Number(m[1]) : 0));
    });

    const results = await projectTranscripts('/repo');
    expect(results).toHaveLength(100);
    // Only the newest 100 were indexed.
    expect(indexSpy).toHaveBeenCalledTimes(100);
    expect(results[0].cliSessionId).toBe('s119');
  });

  it('sorts newest-first across providers and carries profileId through', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'old', transcriptPath: '/-repo/old.jsonl', projectSlug: '-repo' },
        { cliSessionId: 'new', transcriptPath: '/-repo/new.jsonl', projectSlug: '-repo', profileId: 'work' },
      ],
      index: {
        '/-repo/old.jsonl': { text: 'old work', cwd: '' },
        '/-repo/new.jsonl': { text: 'new work', cwd: '' },
      },
    }));
    mockStat.mockImplementation((p) => {
      if (String(p) === '/-repo/new.jsonl') return Promise.resolve(makeStat(500));
      return Promise.resolve(makeStat(100));
    });

    const results = await projectTranscripts('/repo');
    expect(results.map((r) => r.cliSessionId)).toEqual(['new', 'old']);
    expect(results[0].profileId).toBe('work');
    expect(results[1].profileId).toBeUndefined();
  });
});
