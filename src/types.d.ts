// Kittens Game Engine Type Definitions

declare global {
    interface GameResource {
        value: number;
        maxValue: number;
        name: string;
        // The game's own per-tick production/consumption rate for this resource,
        // recomputed every tick (game.js `calcResourcePerTick`) — the same number
        // shown in the resource row's rate column.
        perTickCached: number;
    }

    interface ResPool {
        get(name: string): GameResource;
        resources: Record<string, GameResource>;
    }

    interface Workshop {
        craft(itemName: string, quantity: number): void;
    }

    interface Village {
        getFreeKittens(): number;
        // A single fixed-size hunt squad that does NOT spend any manpower
        // (village.js: `sendHunters: function() { this.gainHuntRes(1); }`) —
        // unlike huntAll(), it never lowers the resource that triggers it.
        sendHunters(): void;
        // Spends all available manpower in squads of 100
        // (`resPool.addResEvent("manpower", -squads * 100)`) before granting
        // hunt loot — the one to use for a danger-zone trigger, since it
        // actually resolves the condition that caused it to fire.
        huntAll(): void;
        promoteKittens(): void;
        jobs: Record<string, number>;
    }

    interface Religion {
        praise(): void;
    }

    interface Calendar {
        // `observeStarEvent` (the name previously here) does not exist on the
        // live engine — confirmed via `typeof gamePage.calendar.observeStarEvent`
        // returning "undefined". observeHandler() is the real function bound to
        // the in-game "Observe" button; it pays out unconditionally whenever
        // called (confirmed live: 25 science granted with no event pending), so
        // callers must gate on observeBtn being set first. See
        // docs/decisions/2026-09-15--observe-star-event-does-not-exist.md.
        observeHandler(): void;
        observeBtn: unknown;
        season: number;
        day: number;
        year: number;
        daysPerSeason: number;
        ticksPerDay: number;
        getCurSeason(): { name: string };
    }

    interface Diplomacy {
        races: Record<string, unknown>;
    }

    interface Upgrade {
        get(name: string): { purchased: boolean };
    }

    interface BldManager {
        get(name: string): { on: number } | undefined;
    }

    interface UiManager {
        // All valid theme ids, including "default" — mirrors the `scheme_<id>`
        // class the game toggles on <body> to switch themes.
        allSchemes: string[];
    }

    interface GameEngine {
        tick(...args: any[]): void;
        togglePause(): void;
        // Set by togglePause(); `tick()` itself no-ops while this is true.
        isPaused: boolean;
        craft(itemName: string, quantity?: number): void;
        // Requires the recipe name — matches the game's own UI call
        // (`game.craftAll(res.name)` in left.jsx.js). Calling it with no
        // argument doesn't craft anything: `workshop.getCraft(undefined)`
        // returns null and `getCraftPrice(null)` throws.
        craftAll(craftName: string): void;
        resPool: ResPool;
        workshop: Workshop;
        village: Village;
        calendar: Calendar;
        diplomacy: Diplomacy;
        religion: Religion;
        upgrade: Upgrade;
        bld: BldManager;
        ui: UiManager;
        // Worst-case (winter-penalty) catnip per-tick rate, recomputed every 25
        // ticks by `updateWinterCatnip()` — the same number the in-game Food
        // Advisor banner uses to warn before an actual famine tick occurs.
        winterCatnipPerTick: number;
        // Active theme id, e.g. "dark" — empty string means the default theme.
        // Set via toggleScheme(); the game mirrors it onto <body> as a
        // `scheme_<id>` class rather than swapping which stylesheet is loaded.
        colorScheme: string;
    }

    interface Window {
        gamePage?: GameEngine;
        game?: GameEngine;
    }
}

export {};
