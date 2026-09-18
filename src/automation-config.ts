// Global automation defaults. Mirrors the existing top-of-file const
// pattern main.ts used before the automations/ module split — "what are
// the defaults" should stay answerable by reading one file.

export const LOG_PREFIX = "😻 [kg-automation]";

// Craft a resource into its next-tier good once it nears its storage cap,
// so production doesn't stall while waiting for a manual check-in.
export const DANGER_ZONE_THRESHOLD = 0.9;
