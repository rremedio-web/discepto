#!/usr/bin/env node
import { runCli } from '../src/cli.mjs';

process.exit(runCli(process.argv.slice(2)));
