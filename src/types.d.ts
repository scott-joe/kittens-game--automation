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
        // batch-verified 2026-09-15 (see the comment above Workshop for what
        // that means). Adds `value` to the named resource, clamped to
        // maxValue unless bypassed — the correct method for granting/removing
        // a resource outside the normal per-tick production path.
        addResEvent(name: string, value: number): number;
        // batch-verified 2026-09-15. `prices` is a `[{name, val}]` array
        // (the same shape buildings/crafts use); returns whether the pool
        // currently holds enough of every listed resource to afford `amt`
        // units of that price list.
        hasRes(prices: Array<{ name: string; val: number }>, amt?: number): boolean;
        // batch-verified 2026-09-15. Sets every resource to its cap.
        maxAll(): void;
    }

    // Methods below carrying "batch-verified 2026-09-15" were confirmed live
    // against kittensgame.com (Ver 1.6.1.6.r163) to exist with the given
    // arity — via `typeof fn === "function"` and `fn.length`, checked across
    // ~60 candidates from scripts/index-engine-api.js run against the
    // reference checkout in one pass. That confirms the name and parameter
    // *count* only, not behavior — treat it as a much stronger starting point
    // than an unverified reference-checkout guess (see
    // docs/decisions/2026-09-15--observe-star-event-does-not-exist.md and
    // 2026-09-15--act-firing-every-tick.md for what unverified guesses cost),
    // but still verify behavior live before relying on a new one in
    // automation logic, the way huntAll()/observeHandler() were.
    interface Workshop {
        craft(itemName: string, quantity: number): void;
        // batch-verified 2026-09-15. Returns the upgrade/tech metadata object
        // (`.researched: boolean`, `.unlocked`, `.prices`, ...) — this is the
        // correct path for upgrade status; there is no separate top-level
        // `gamePage.upgrade` manager (that property is a bare constructor
        // function, not an object with `.get()` — a prior version of this
        // file incorrectly documented one, see the Upgrade interface removal
        // in this same commit).
        get(upgradeName: string): { researched: boolean; unlocked: boolean };
        // batch-verified 2026-09-15.
        getCraft(craftName: string): unknown;
        // batch-verified 2026-09-15.
        getCraftAllCount(craftName: string): number;
        // batch-verified 2026-09-15.
        unlock(upgradeName: string): void;
        // batch-verified 2026-09-15.
        unlockAll(): void;
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
        // batch-verified 2026-09-15.
        getJob(jobName: string): unknown;
        // batch-verified 2026-09-15.
        getJobLimit(jobName: string): number;
        // batch-verified 2026-09-15, with a correction: the reference
        // checkout's index (village.js) showed 2 params (`job, amt`); the
        // live function is `function(job, amt, optimize)` — a 3rd parameter
        // added since that checkout was captured. Confirms this repo's
        // standing caution that the reference checkout can be stale.
        assignJob(job: string, amt: number, optimize?: boolean): void;
        // batch-verified 2026-09-15.
        unassignJob(kitten: unknown): void;
        // batch-verified 2026-09-15.
        hasFreeKittens(amt: number): boolean;
        // batch-verified 2026-09-15.
        getKittens(): unknown[];
        // batch-verified 2026-09-15.
        holdFestival(amt: number): void;
        // batch-verified 2026-09-15.
        optimizeJobs(): void;
    }

    interface Religion {
        praise(): void;
        // batch-verified 2026-09-15. Ziggurat upgrade metadata.
        getZU(name: string): unknown;
        // batch-verified 2026-09-15. Religion upgrade metadata.
        getRU(name: string): unknown;
        // batch-verified 2026-09-15. Transcendence upgrade metadata.
        getTU(name: string): unknown;
        // batch-verified 2026-09-15. Pact metadata (Sacrifice Albino Bats
        // section).
        getPact(name: string): unknown;
        // batch-verified 2026-09-15.
        transcend(): void;
        // batch-verified 2026-09-15.
        resetFaith(bonusRatio: number, withConfirmation?: boolean): void;
        // batch-verified 2026-09-15.
        turnHGOff(): void;
    }

    interface Science {
        // batch-verified 2026-09-15. Tech metadata (`.researched`, etc.) —
        // same shape convention as Workshop.get/BldManager.get.
        get(techName: string): { researched: boolean; unlocked: boolean };
        // batch-verified 2026-09-15.
        getPolicy(name: string): unknown;
        // batch-verified 2026-09-15.
        getPrices(techName: string): unknown;
        // batch-verified 2026-09-15.
        unlockAll(): void;
    }

    interface Prestige {
        // batch-verified 2026-09-15. Prestige perk metadata (`.researched`).
        getPerk(name: string): { researched: boolean };
        // batch-verified 2026-09-15.
        getSpentParagon(): number;
    }

    interface TimeManager {
        // batch-verified 2026-09-15. Accelerates time by `amt` chronospheres
        // (Chronoforge "Shatter TC" action).
        shatter(amt: number): void;
        // batch-verified 2026-09-15. Chronoforge upgrade metadata.
        getCFU(id: string): unknown;
        // batch-verified 2026-09-15. Void Space upgrade metadata.
        getVSU(id: string): unknown;
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
        // batch-verified 2026-09-15. Destroys observeBtn and resets
        // observeRemainingTime — observeHandler() itself calls this first.
        observeClear(): void;
        // batch-verified 2026-09-15. The countdown that resolves a pending
        // event automatically (with `starAutoSuccessChance`-gated odds) if
        // the player doesn't click the Observe button in time.
        observeTimeout(): void;
        season: number;
        day: number;
        year: number;
        daysPerSeason: number;
        ticksPerDay: number;
        getCurSeason(): { name: string };
        // batch-verified 2026-09-15. Per-resource weather production
        // modifier for the current season (e.g. Catnip Field's Spring/Winter
        // swing referenced in the Village building description).
        getWeatherMod(resName: string): number;
    }

    interface Diplomacy {
        races: Record<string, unknown>;
        // batch-verified 2026-09-15.
        get(raceName: string): unknown;
        // batch-verified 2026-09-15.
        getTradeRatio(): number;
        // batch-verified 2026-09-15.
        trade(race: unknown): void;
        // batch-verified 2026-09-15.
        tradeAll(race: unknown): void;
        // batch-verified 2026-09-15.
        unlockRandomRace(): void;
        // batch-verified 2026-09-15.
        buyBcoin(): void;
        // batch-verified 2026-09-15, with a correction: the reference
        // checkout's index (diplomacy.js) showed 0 params; the live function
        // is `function(isHodl)` — a parameter added since that checkout was
        // captured. Same class of drift as Village.assignJob above.
        sellBcoin(isHodl?: boolean): void;
    }

    interface BldManager {
        get(name: string): { on: number } | undefined;
        // batch-verified 2026-09-15. Full building metadata wrapper (prices,
        // unlock state, effects, ...) — `get()` above is the deprecated
        // shorthand per the reference checkout's own comment on it.
        getBuildingExt(name: string): unknown;
        // batch-verified 2026-09-15.
        getPrices(bldName: string, additionalBought?: number): Array<{ name: string; val: number }>;
        // batch-verified 2026-09-15.
        isUnlocked(building: string): boolean;
        // batch-verified 2026-09-15.
        isUnlockable(building: string): boolean;
        // batch-verified 2026-09-15. Runs one manual "Gather catnip" click.
        gatherCatnip(): void;
        // batch-verified 2026-09-15. Runs one manual "Refine catnip" click.
        refineCatnip(): void;
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
        science: Science;
        prestige: Prestige;
        time: TimeManager;
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
