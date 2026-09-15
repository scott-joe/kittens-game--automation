#!/usr/bin/env node
// Copies src/styles/*.css into dist/styles/ (server.js serves dist/ as its
// web root, so these become fetchable at /styles/<name>.css). Pure Node fs
// — no dependency, works identically on macOS/Linux/Windows.
//
// Usage:
//   node scripts/copy-styles.js          one-shot copy
//   node scripts/copy-styles.js --watch  copy once, then re-copy on change
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "src", "styles");
const DEST_DIR = path.join(__dirname, "..", "dist", "styles");

function copyStyles() {
	fs.cpSync(SRC_DIR, DEST_DIR, { recursive: true });
	console.log(`[copy-styles] copied ${SRC_DIR} -> ${DEST_DIR}`);
}

copyStyles();

if (process.argv.includes("--watch")) {
	console.log(`[copy-styles] watching ${SRC_DIR} for changes...`);
	// No `recursive: true` here — that fs.watch option is macOS/Windows-only
	// in Node and unsupported on Linux. src/styles is flat, so a
	// non-recursive watch is sufficient and stays portable.
	fs.watch(SRC_DIR, () => {
		try {
			copyStyles();
		} catch (err) {
			console.warn("[copy-styles] copy failed:", err);
		}
	});
}
