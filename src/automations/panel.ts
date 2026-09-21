import { LOG_PREFIX } from "../automation-config.js";
import { AutomationEntry, onAutomationChange, setEnabled } from "./registry.js";

const PANEL_ID = "kg-automation-panel";

/**
 * Injects the floating toggle panel into <body> and wires each checkbox to
 * the same registry object/setEnabled helper that window.kgAutomation
 * already reads and writes, so both surfaces stay in sync automatically.
 * Guards against double-injection the same way loadAndInjectStyle does.
 */
export function installPanel(registry: AutomationEntry[]): void {
	try {
		if (document.getElementById(PANEL_ID)) {
			return;
		}

		const panel = document.createElement("div");
		panel.id = PANEL_ID;

		const header = document.createElement("div");
		header.id = `${PANEL_ID}-header`;
		header.textContent = "🐱 Automation";

		const body = document.createElement("div");
		body.id = `${PANEL_ID}-body`;
		// Starts collapsed: expanded, the full entry list can overlap the
		// game's own building columns on wide viewports (the game adds more
		// columns as a run progresses, so there's no fixed-width panel that
		// stays clear at every screen size/game stage). Collapsed, only the
		// small header sits over the top bar, which does stay clear.
		body.classList.add("kg-automation-collapsed");

		header.addEventListener("click", () => {
			body.classList.toggle("kg-automation-collapsed");
		});

		// Tracked so onAutomationChange (below) can update the right checkbox
		// when a change comes from elsewhere (console API, another panel
		// instance) instead of from this checkbox's own "change" event.
		const checkboxesById = new Map<string, HTMLInputElement>();

		const list = document.createElement("ul");
		for (const entry of registry) {
			const item = document.createElement("li");

			const checkboxId = `${PANEL_ID}-toggle-${entry.id}`;
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.id = checkboxId;
			checkbox.checked = entry.enabled;
			checkbox.addEventListener("change", () => {
				setEnabled(registry, entry.id, checkbox.checked);
			});
			checkboxesById.set(entry.id, checkbox);

			const label = document.createElement("label");
			label.htmlFor = checkboxId;
			label.textContent = entry.label;

			item.appendChild(checkbox);
			item.appendChild(label);
			list.appendChild(item);
		}
		body.appendChild(list);

		panel.appendChild(header);
		panel.appendChild(body);
		document.body.appendChild(panel);

		// Keeps this panel's checkboxes in sync with changes made through
		// window.kgAutomation.toggle() (or any other setEnabled() caller),
		// not just changes originating from this panel's own checkboxes.
		onAutomationChange((id, enabled) => {
			const checkbox = checkboxesById.get(id);
			if (checkbox && checkbox.checked !== enabled) {
				checkbox.checked = enabled;
			}
		});

		console.log(`${LOG_PREFIX} toggle panel installed (${registry.length} entries)`);
	} catch (err) {
		console.warn(`${LOG_PREFIX} failed to install toggle panel:`, err);
	}
}
