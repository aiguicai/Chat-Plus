import type { OrchestrationTab } from "../types";

export function getEffectiveOrchestrationTabEnabled(
  tab: Pick<OrchestrationTab, "connected" | "desiredEnabled">,
) {
  return Boolean(tab.connected && tab.desiredEnabled);
}

export function shouldRefreshOrchestrationTabOnEnable(
  tab: Pick<OrchestrationTab, "connected">,
  nextEnabled: boolean,
) {
  return Boolean(nextEnabled && !tab.connected);
}
