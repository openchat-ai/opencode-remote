import { createRequire } from 'node:module';
import Module from 'node:module';
import { platform } from 'os';
const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
// Suppress only DEP0190 warning (shell args concatenation) from SDK internals
const originalEmit = process.emit;
process.emit = function (name, warning) {
    if (name === 'warning' && warning && warning.code === 'DEP0190') return;
    return originalEmit.apply(this, arguments);
};
const originalSpawn = childProcess.spawn;
childProcess.spawn = function patchedSpawn(command, args, options = {}) {
    // On Windows, use shell for commands that need PATH resolution
    const isWindows = platform() === 'win32';
    if (isWindows && !options.shell && typeof command === 'string' && !command.includes('\\') && !command.includes('/')) {
        options = { ...options, shell: true };
    }
    return originalSpawn.call(this, command, args, options);
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    const result = originalLoad.apply(this, arguments);
    if (request === 'child_process' || request === 'node:child_process') {
        result.spawn = childProcess.spawn;
    }
    return result;
};
