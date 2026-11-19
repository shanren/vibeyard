import type { InspectorEvent, ToolUsageStats, ContextDataPoint } from '../shared/types';

type ChangeCallback = (sessionId: string) => void;

const MAX_EVENTS = 2000;
const sessionEvents = new Map<string, InspectorEvent[]>();
const listeners: ChangeCallback[] = [];

// Cached cost deltas, invalidated when events change

export function addEvents(sessionId: string, events: InspectorEvent[]): void {
  const existing = sessionEvents.get(sessionId) ?? [];
  existing.push(...events);
  // Cap at MAX_EVENTS, drop oldest
  if (existing.length > MAX_EVENTS) {
    existing.splice(0, existing.length - MAX_EVENTS);
  }
  sessionEvents.set(sessionId, existing);
  // Invalidate cache when events change
  for (const cb of listeners) cb(sessionId);
}

export function getEvents(sessionId: string): InspectorEvent[] {
  return sessionEvents.get(sessionId) ?? [];
}

export function getToolStats(sessionId: string): ToolUsageStats[] {
  const events = sessionEvents.get(sessionId) ?? [];
  const statsMap = new Map<string, ToolUsageStats>();

  // Cost snapshots live on synthetic status_update events, not on tool events.
  let lastToolStats: ToolUsageStats | null = null;
  let prevCost: number | null = null;

  for (const ev of events) {
    if (ev.type === 'tool_use' || ev.type === 'tool_failure') {
      const name = ev.tool_name ?? 'unknown';
      let stats = statsMap.get(name);
      if (!stats) {
        stats = { tool_name: name, calls: 0, failures: 0 };
        statsMap.set(name, stats);
      }
      stats.calls++;
      if (ev.type === 'tool_failure') stats.failures++;
      lastToolStats = stats;
    }

  }

  return Array.from(statsMap.values()).sort((a, b) => b.calls - a.calls);
}

export function getContextHistory(sessionId: string): ContextDataPoint[] {
  const events = sessionEvents.get(sessionId) ?? [];
  const points: ContextDataPoint[] = [];
  for (const ev of events) {
    if (ev.context_snapshot) {
      points.push({
        timestamp: ev.timestamp,
        usedPercentage: ev.context_snapshot.used_percentage,
        totalTokens: ev.context_snapshot.total_tokens,
      });
    }
  }
  return points;
}

export function onChange(callback: ChangeCallback): void {
  listeners.push(callback);
}

export function clearSession(sessionId: string): void {
  sessionEvents.delete(sessionId);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  sessionEvents.clear();
  listeners.length = 0;
}
