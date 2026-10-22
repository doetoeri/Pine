#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
 echo 'Node.js 22 or later is required: https://nodejs.org/'
 exit 1
fi
node server/server.mjs
