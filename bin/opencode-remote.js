#!/usr/bin/env node
import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '../dist/cli.js');

spawn('node', [cliPath, ...process.argv.slice(1)], { stdio: 'inherit' });
