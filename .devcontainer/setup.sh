#!/bin/sh
# Devcontainer path without docker: a global Node-RED with this package
# npm-linked into ./sandbox. Then `npm run nd` (run) or `npm run watch`
# (restart on changes under gree-hvac/).

npm install
npm link
npm install -g --unsafe-perm node-red@5

mkdir -p sandbox
cd sandbox
npm link node-red-contrib-gree-hvac
