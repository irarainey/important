/**
 * Runtime hook that redirects `require('vscode')` to the compiled mock.
 *
 * Loaded via mocha `--require` before any test files.  At this point
 * the output has already been compiled by tsc; the mock lives at
 * `output/test/tests/unit/mocks/vscode.js`.
 */

"use strict";

const path = require("path");
const Module = require("module");

const original = Module._resolveFilename;
const mockPath = path.resolve(__dirname, "../../output/test/tests/unit/mocks/vscode.js");

Module._resolveFilename = function (request, parent, isMain, options) {
	if (request === "vscode") {
		return mockPath;
	}
	return original.call(this, request, parent, isMain, options);
};
