import type { ProviderId, CliProviderMeta, CliProviderCapabilities } from '../shared/types.js';

let cachedProviders: CliProviderMeta[] | null = null;
let cachedAvailability: Map<ProviderId, boolean> | null = null;
let availabilityLoadPromise: Promise<void> | null = null;

export async function loadProviderMetas(): Promise<void> {
  if (!cachedProviders) {
    cachedProviders = await window.rcode.provider.listProviders();
  }
}

export async function loadProviderAvailability(): Promise<void> {
  if (cachedAvailability) return;
  if (availabilityLoadPromise) return availabilityLoadPromise;
  availabilityLoadPromise = (async () => {
    await loadProviderMetas();
    const checks = await Promise.all(
      cachedProviders!.map(async p => ({ id: p.id, ok: await window.rcode.provider.checkBinary(p.id) }))
    );
    cachedAvailability = new Map(checks.map(c => [c.id, c.ok]));
  })();
  try {
    await availabilityLoadPromise;
  } finally {
    availabilityLoadPromise = null;
  }
}

/**
 * The provider a bare "New session" click should launch.
 *
 * Order: the user's configured default when it is actually installed, otherwise
 * the first installed provider, otherwise the configured value (or 'claude') so
 * the caller still has something to name in an error.
 *
 * Without the middle step, setting the default to a CLI and later uninstalling it
 * left the button spawning a binary that no longer exists.
 */
export function resolveDefaultProviderId(
  isAvailable: (id: ProviderId) => boolean,
  configured?: ProviderId,
): ProviderId {
  if (configured && isAvailable(configured)) return configured;
  const firstInstalled = cachedProviders?.find((p) => cachedAvailability?.get(p.id));
  if (firstInstalled) return firstInstalled.id;
  return configured ?? 'claude';
}

export function hasMultipleAvailableProviders(): boolean {
  if (!cachedAvailability) return false;
  let count = 0;
  for (const ok of cachedAvailability.values()) {
    if (ok) count++;
    if (count > 1) return true;
  }
  return false;
}

export function getProviderAvailabilitySnapshot(): {
  providers: CliProviderMeta[];
  availability: Map<ProviderId, boolean>;
} | null {
  if (!cachedProviders || !cachedAvailability) return null;
  return {
    providers: cachedProviders,
    availability: cachedAvailability,
  };
}

export function getCachedProviderMetas(): CliProviderMeta[] {
  return cachedProviders ?? [];
}

export function getAvailableProviderMetas(): CliProviderMeta[] {
  if (!cachedProviders || !cachedAvailability) return [];
  return cachedProviders.filter(p => cachedAvailability!.get(p.id));
}

export function getProviderCapabilities(providerId: ProviderId): CliProviderCapabilities | null {
  if (!cachedProviders) return null;
  return cachedProviders.find(provider => provider.id === providerId)?.capabilities ?? null;
}

export function getProviderDisplayName(providerId: ProviderId): string {
  if (!cachedProviders) return providerId;
  return cachedProviders.find(provider => provider.id === providerId)?.displayName ?? providerId;
}
