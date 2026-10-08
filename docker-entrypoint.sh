#!/bin/sh
set -eu
node scripts/prepare-database.mjs
exec node dist/src/index.js
