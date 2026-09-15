#!/usr/bin/env node
// Scans reference-checkout .js file(s) for `dojo.declare(...)` subsystem
// definitions and prints a Markdown listing of each declared method's name,
// parameters, arity, and source line. Uses the TypeScript compiler API
// (already a devDependency) to parse the pre-ES6 dojo-toolkit source as
// plain JS — no new dependency, no build-step involvement.
//
// This is a candidate-finder, not a source of truth: the reference checkout
// it reads from may be an older build than the live game (see CLAUDE.md /
// docs/architecture/automation-harness.md), and this tool only reads
// declared arity/names, not behavior. Every signature it surfaces must be
// cross-checked live before it goes into src/types.d.ts — see
// docs/guides/local-development.md, "Adding engine API types".
//
// Usage:
//   node scripts/index-engine-api.js <file...> [--out <path>] [--class <substring>]
//
//   <file...>       One or more literal paths to reference-checkout .js
//                   files (no glob support, kept dependency-free).
//   --out <path>    Write the Markdown report to this path instead of stdout.
//   --class <sub>   Only include dojo.declare classes whose fully-qualified
//                   name contains <sub> (case-insensitive).
//
// Example:
//   node scripts/index-engine-api.js \
//     /path/to/kitten-game--orig/js/workshop.js --out /tmp/workshop.md
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

function parseArgs(argv) {
	const files = [];
	let outPath = null;
	let classFilter = null;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--out") {
			outPath = argv[++i];
		} else if (arg === "--class") {
			classFilter = argv[++i];
		} else if (arg === "--help" || arg === "-h") {
			printUsageAndExit(0);
		} else {
			files.push(arg);
		}
	}

	return { files, outPath, classFilter };
}

function printUsageAndExit(code) {
	console.log(
		"Usage: node scripts/index-engine-api.js <file...> [--out <path>] [--class <substring>]"
	);
	process.exit(code);
}

// Renders a single function parameter, handling destructuring/defaults/rest
// without crashing on shapes this codebase doesn't currently use.
function formatParam(param, sourceFile) {
	let name = ts.isIdentifier(param.name) ? param.name.text : param.name.getText(sourceFile);
	if (param.dotDotDotToken) name = "..." + name;
	if (param.questionToken) name += "?";
	if (param.initializer) name += " = " + param.initializer.getText(sourceFile);
	return name;
}

// Best-effort doc comment extraction: prefer a real JSDoc block, fall back
// to plain leading `//` comments (the more common style in this codebase).
function extractComment(node, sourceFile, sourceText) {
	const jsDocs = ts.getJSDocCommentsAndTags(node);
	for (const doc of jsDocs) {
		if (ts.isJSDoc(doc) && doc.comment) {
			const text =
				typeof doc.comment === "string"
					? doc.comment
					: doc.comment.map((part) => part.text || "").join("");
			if (text.trim()) return text.trim().replace(/\s+/g, " ");
		}
	}

	const leading = ts.getLeadingCommentRanges(sourceText, node.getFullStart());
	if (!leading || leading.length === 0) return undefined;

	const text = leading
		.map((range) => sourceText.slice(range.pos, range.end))
		.join(" ")
		.replace(/\/\*+|\*+\//g, " ")
		.replace(/^\s*\/\/\s?/gm, "")
		.replace(/^\s*\*\s?/gm, "")
		.replace(/\s+/g, " ")
		.trim();

	return text || undefined;
}

function formatSuperclass(node, sourceFile) {
	if (ts.isArrayLiteralExpression(node)) {
		return "[" + node.elements.map((el) => el.getText(sourceFile)).join(", ") + "]";
	}
	return node.getText(sourceFile);
}

// Indexes one file's dojo.declare(...) calls into classMap, keyed by fully
// qualified class name. Mutates classMap; merges into an existing entry
// (with a stderr note) if the same class name shows up more than once
// across the files passed in one run.
function indexFile(filePath, classMap) {
	const sourceText = fs.readFileSync(filePath, "utf8");
	const sourceFile = ts.createSourceFile(
		filePath,
		sourceText,
		ts.ScriptTarget.ES2015,
		/* setParentNodes */ true,
		ts.ScriptKind.JS
	);

	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.expression.getText(sourceFile) === "dojo" &&
			node.expression.name.getText(sourceFile) === "declare"
		) {
			handleDeclare(node);
		}
		ts.forEachChild(node, visit);
	}

	function handleDeclare(callExpr) {
		const [nameArg, superclassArg, membersArg] = callExpr.arguments;
		const line = ts.getLineAndCharacterOfPosition(sourceFile, callExpr.getStart(sourceFile)).line + 1;

		if (!nameArg || !ts.isStringLiteral(nameArg)) {
			console.warn(`[index-engine-api] ${filePath}:${line}: dojo.declare with non-string-literal name; skipping`);
			return;
		}
		if (!membersArg || !ts.isObjectLiteralExpression(membersArg)) {
			console.warn(`[index-engine-api] ${filePath}:${line}: dojo.declare "${nameArg.text}" has no object-literal member arg; skipping`);
			return;
		}

		const className = nameArg.text;
		const superclass = superclassArg ? formatSuperclass(superclassArg, sourceFile) : "(none)";
		const methods = [];

		for (const property of membersArg.properties) {
			let name;
			let params;

			if (ts.isPropertyAssignment(property)) {
				const isFn =
					ts.isFunctionExpression(property.initializer) || ts.isArrowFunction(property.initializer);
				if (!isFn) continue; // data member (array/object/primitive) — not a method

				name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
					? property.name.text
					: property.name.getText(sourceFile);
				params = property.initializer.parameters;
			} else if (ts.isMethodDeclaration(property)) {
				name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
					? property.name.text
					: property.name.getText(sourceFile);
				params = property.parameters;
			} else {
				continue;
			}

			const paramList = params.map((p) => formatParam(p, sourceFile));
			const methodLine =
				ts.getLineAndCharacterOfPosition(sourceFile, property.getStart(sourceFile)).line + 1;
			const comment = extractComment(property, sourceFile, sourceText);

			methods.push({
				name,
				params: paramList.join(", "),
				arity: params.length,
				line: methodLine,
				comment,
			});
		}

		if (classMap.has(className)) {
			console.warn(`[index-engine-api] duplicate dojo.declare "${className}" — merging method lists`);
			classMap.get(className).methods.push(...methods);
		} else {
			classMap.set(className, { superclass, sourceFile: filePath, methods });
		}
	}

	visit(sourceFile);
}

function renderMarkdown(classMap, sourcesScanned, classFilter) {
	const lines = [];
	lines.push("# Engine API candidates — GENERATED FROM REFERENCE CHECKOUT, NOT LIVE-VERIFIED");
	lines.push("");
	lines.push("Source(s) scanned:");
	for (const src of sourcesScanned) lines.push(`- ${src}`);
	lines.push("");
	lines.push(
		"**These are candidates from a possibly-stale reference checkout — cross-check " +
			"every signature live (chrome-devtools MCP / browser-debug skill) before adding " +
			"it to src/types.d.ts.** See docs/guides/local-development.md, " +
			'"Adding engine API types".'
	);
	lines.push("");
	lines.push(
		"Note: arity is the declared-parameter count, which can differ from a live " +
			"`fn.length` if defaults/rest params are present."
	);
	lines.push("");
	lines.push("---");

	let anyPrinted = false;
	for (const [className, info] of classMap) {
		if (classFilter && !className.toLowerCase().includes(classFilter.toLowerCase())) continue;
		anyPrinted = true;

		lines.push("");
		lines.push(`## ${className}`);
		lines.push(`extends \`${info.superclass}\``);
		lines.push(`(${path.basename(info.sourceFile)})`);
		lines.push("");

		if (info.methods.length === 0) {
			lines.push("_No methods found._");
			continue;
		}

		lines.push("| Method | Params | Arity | Line | Doc |");
		lines.push("| --- | --- | --- | --- | --- |");
		for (const m of info.methods) {
			lines.push(
				`| \`${m.name}\` | \`${m.params}\` | ${m.arity} | ${m.line} | ${m.comment || ""} |`
			);
		}
	}

	if (!anyPrinted) {
		lines.push("");
		lines.push("_No dojo.declare candidates found._");
	}

	return lines.join("\n") + "\n";
}

function main() {
	const { files, outPath, classFilter } = parseArgs(process.argv.slice(2));

	if (files.length === 0) {
		console.error("[index-engine-api] no input files given.");
		printUsageAndExit(1);
	}

	for (const file of files) {
		if (!fs.existsSync(file)) {
			console.error(`[index-engine-api] file not found: ${file}`);
			process.exit(1);
		}
	}

	const classMap = new Map();
	for (const file of files) {
		indexFile(file, classMap);
	}

	const report = renderMarkdown(classMap, files, classFilter);

	if (outPath) {
		fs.writeFileSync(outPath, report, "utf8");
		console.log(`[index-engine-api] wrote ${classMap.size} candidate class(es) to ${outPath}`);
	} else {
		process.stdout.write(report);
	}
}

main();
