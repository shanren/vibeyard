import * as fs from 'fs';
import type { DeepSearchResult, ProjectTranscript } from '../shared/types';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import { getAllProviders } from './providers/registry';
import { TRANSCRIPT_TEXT_SEPARATOR } from './providers/transcript-utils';

const MAX_DERIVED_NAME_LENGTH = 80;

const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  text: string;
  textLower: string;
  cwd: string;
  mtime: number;
}

const textCache = new Map<string, CacheEntry>();

export function _resetForTesting(): void {
  textCache.clear();
}

async function getCachedIndex(provider: CliProvider, transcriptPath: string): Promise<CacheEntry> {
  try {
    const stat = await fs.promises.stat(transcriptPath);
    const mtime = stat.mtimeMs;
    const cached = textCache.get(transcriptPath);
    if (cached && cached.mtime === mtime) {
      // Move-to-end for true LRU semantics on cache hits.
      textCache.delete(transcriptPath);
      textCache.set(transcriptPath, cached);
      return cached;
    }

    if (textCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = textCache.keys().next().value;
      if (oldest) textCache.delete(oldest);
    }

    const { text, cwd } = await provider.indexTranscript!(transcriptPath);
    const entry: CacheEntry = { text, textLower: text.toLowerCase(), cwd, mtime };
    textCache.set(transcriptPath, entry);
    return entry;
  } catch {
    return { text: '', textLower: '', cwd: '', mtime: 0 };
  }
}

function scoreFuzzy(textLower: string, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (textLower.includes(q)) return 100;

  const words = q.split(/\s+/).filter(Boolean);
  const matched = words.filter(w => textLower.includes(w));
  if (matched.length === words.length) return 80;
  if (matched.length > 0) return Math.round((matched.length / words.length) * 50);
  return 0;
}

function deriveName(text: string): string | undefined {
  const first = text.split(TRANSCRIPT_TEXT_SEPARATOR)[0]?.trim();
  if (!first) return undefined;
  const oneLine = first.replace(/\s+/g, ' ');
  return oneLine.length > MAX_DERIVED_NAME_LENGTH
    ? oneLine.slice(0, MAX_DERIVED_NAME_LENGTH - 1).trimEnd() + '…'
    : oneLine;
}

function extractSnippet(text: string, textLower: string, query: string): string {
  const q = query.toLowerCase().trim();
  let idx = textLower.indexOf(q);
  if (idx === -1) {
    const firstWord = q.split(/\s+/)[0];
    idx = firstWord ? textLower.indexOf(firstWord) : -1;
  }
  if (idx === -1) idx = 0;

  const RADIUS = 60;
  const start = Math.max(0, idx - RADIUS);
  const end = Math.min(text.length, idx + q.length + RADIUS);
  let snippet = text.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}

async function searchOneProvider(provider: CliProvider, query: string): Promise<DeepSearchResult[]> {
  if (!provider.discoverTranscripts || !provider.indexTranscript) return [];
  let descriptors: TranscriptDescriptor[];
  try {
    descriptors = await provider.discoverTranscripts();
  } catch {
    return [];
  }
  const indexed = await Promise.all(descriptors.map(async (desc) => {
    const entry = await getCachedIndex(provider, desc.transcriptPath);
    return { desc, entry };
  }));
  // Same cliSessionId can appear under multiple project slugs (e.g. Claude
  // resumes that move between cwds); keep the highest-scoring transcript.
  const best = new Map<string, { desc: TranscriptDescriptor; entry: CacheEntry; score: number }>();
  for (const { desc, entry } of indexed) {
    if (!entry.textLower) continue;
    const score = scoreFuzzy(entry.textLower, query);
    if (score === 0) continue;
    const prev = best.get(desc.cliSessionId);
    if (!prev || score > prev.score) best.set(desc.cliSessionId, { desc, entry, score });
  }
  const out: DeepSearchResult[] = [];
  for (const { desc, entry, score } of best.values()) {
    out.push({
      providerId: provider.meta.id,
      cliSessionId: desc.cliSessionId,
      projectSlug: desc.projectSlug ?? '',
      projectCwd: desc.projectCwd || entry.cwd,
      snippet: extractSnippet(entry.text, entry.textLower, query),
      score,
      derivedName: deriveName(entry.text),
      profileId: desc.profileId,
    });
  }
  return out;
}

export async function searchSessions(query: string): Promise<DeepSearchResult[]> {
  const all = await Promise.all(getAllProviders().map((p) => searchOneProvider(p, query)));
  const results = all.flat();
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

/** Normalize a path for cross-platform project matching (case + separators). */
function normProjectPath(p: string): string {
  return p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

/** Bound on how many transcripts are indexed+returned per project (newest kept). */
const MAX_PROJECT_TRANSCRIPTS = 100;

/**
 * List transcripts that belong to a single project, for the per-project Sessions
 * panel. Providers attribute transcripts differently: Claude slugs the project
 * path (`projectSlug`), while Copilot/Gemini record the working directory
 * (`projectCwd`). Codex transcripts carry neither, so they can't be attributed.
 * Sorted newest-first, deduped by (providerId, cliSessionId).
 */
export async function projectTranscripts(projectPath: string): Promise<ProjectTranscript[]> {
  const slug = projectPath.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const normCwd = normProjectPath(projectPath);

  const perProvider = await Promise.all(getAllProviders().map(async (provider) => {
    if (!provider.discoverTranscripts || !provider.indexTranscript) return [];
    let descriptors: TranscriptDescriptor[];
    try {
      descriptors = await provider.discoverTranscripts();
    } catch {
      return [];
    }
    // Prefer the working directory when recorded: Copilot/Gemini set projectCwd,
    // and Gemini's projectSlug is a ~/.gemini/tmp project-key hash, not the path.
    // Fall back to the slug for providers like Claude that only carry projectSlug.
    const matched = descriptors.filter((d) => {
      if (d.projectCwd) return normProjectPath(d.projectCwd) === normCwd;
      if (d.projectSlug) return d.projectSlug.toLowerCase() === slug;
      return false;
    });
    // Stat all matches (cheap) so only the newest MAX_PROJECT_TRANSCRIPTS get
    // read+parsed — a transcript-heavy project shouldn't trigger a full re-index
    // of every file just to populate a bounded list.
    const withMtime = await Promise.all(matched.map(async (desc) => {
      let mtime = 0;
      try {
        mtime = (await fs.promises.stat(desc.transcriptPath)).mtimeMs;
      } catch {
        // transcript vanished mid-scan; keep mtime 0
      }
      return { desc, mtime };
    }));
    withMtime.sort((a, b) => b.mtime - a.mtime);
    const items = await Promise.all(withMtime.slice(0, MAX_PROJECT_TRANSCRIPTS).map(async ({ desc, mtime }) => {
      const entry = await getCachedIndex(provider, desc.transcriptPath);
      return {
        providerId: provider.meta.id,
        cliSessionId: desc.cliSessionId,
        transcriptPath: desc.transcriptPath,
        name: deriveName(entry.text) ?? `${desc.cliSessionId.slice(0, 8)}…`,
        mtimeMs: entry.mtime || mtime,
        profileId: desc.profileId,
      };
    }));
    return items;
  }));

  const seen = new Set<string>();
  const out: ProjectTranscript[] = [];
  for (const item of perProvider.flat().sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    const key = `${item.providerId}:${item.cliSessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
