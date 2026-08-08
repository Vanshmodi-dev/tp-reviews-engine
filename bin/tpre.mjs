#!/usr/bin/env node
import { main } from '../src/cli/composition.mjs';

await main(process.argv.slice(2));
