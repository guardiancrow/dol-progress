import type { DiscoveryCategorySummary } from "../domain/models";

export const RELIC_CATEGORY_NAME = "レリック";

export interface DiscoveryCapabilities {
  canReport: boolean;
  hasCard: boolean;
}

const DEFAULT_CAPABILITIES: DiscoveryCapabilities = {
  canReport: true,
  hasCard: true,
};

const RELIC_CAPABILITIES: DiscoveryCapabilities = {
  canReport: false,
  hasCard: false,
};

export function discoveryCapabilities(
  category: DiscoveryCategorySummary | null,
): DiscoveryCapabilities {
  return category?.name === RELIC_CATEGORY_NAME
    ? RELIC_CAPABILITIES
    : DEFAULT_CAPABILITIES;
}
