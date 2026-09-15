// ==UserScript==
// @name         Kittens Game Dev Loader
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Loads Kittens Game automation from local development server
// @author       scott-joe
// @match        https://kittensgame.com/web/*
// @grant        none
// ==/UserScript==

(() => {
	const SCRIPT_URL = "http://127.0.0.1:5500/main.js";

	const script = document.createElement("script");
	// Served by this project's own dev server (`pnpm run dev` / `pnpm run server`),
	// which serves the dist/ folder as its web root — see server.js.
	script.src = SCRIPT_URL;
	script.onload = () => {
		console.log("[Kittens Automation] Loader: Script loaded successfully");
	};
	script.onerror = () => {
		console.error(`[Kittens Automation] Loader: Failed to load script from ${SCRIPT_URL}`);
		console.error(
			'[Kittens Automation] Loader: Ensure the dev server is running: `pnpm run dev` (or `pnpm run server`) in the project folder',
		);
	};
	document.body.appendChild(script);
})();
