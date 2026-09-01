#!/usr/bin/env node
/**
 * The console entry point.
 *
 * The only file in the project that knows about `process` and `fs`. Everything
 * it does is a one-line adaptation of the real world to the interfaces in
 * `cli.ts`, so there is nothing here that can be wrong in an interesting way.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { nodeIo, run } from './cli.js';

const io = nodeIo(
  (path) => readFileSync(path, 'utf8'),
  process.cwd(),
  (text) => process.stdout.write(text),
  (text) => process.stderr.write(text),
);

process.exitCode = run(process.argv.slice(2), io);
