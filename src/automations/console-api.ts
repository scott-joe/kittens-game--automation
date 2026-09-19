import { LOG_PREFIX } from "../automation-config.js";
import { AutomationEntry, setEnabled } from "./registry.js";

export interface AutomationConsoleEntry {
	id: string;
	label: string;
	enabled: boolean;
}

export interface AutomationConsoleAPI {
	list(): AutomationConsoleEntry[];
	toggle(id: string, enabled: boolean): boolean;
}

/**
 * Exposes the registry's enable/disable state as a console-callable API
 * (`window.kgAutomation`) — the v0 toggle surface from
 * docs/automation-console/02-design-toggles.md, intended to stay useful
 * even after the DOM panel (Task 4) ships, since both read/write the same
 * registry object.
 */
export function installConsoleApi(registry: AutomationEntry[]): void {
	window.kgAutomation = {
		list: () => registry.map(({ id, label, enabled }) => ({ id, label, enabled })),
		toggle: (id, enabled) => setEnabled(registry, id, enabled),
	};
	console.log(`${LOG_PREFIX} console API installed: window.kgAutomation.list() / .toggle(id, enabled)`);
}
