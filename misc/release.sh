#!/bin/bash

set -e

# Clean
rm -rf _temp || true
rm -rf dist || true
rm -rf node_modules || true
mkdir -p _temp

# Build
npm ci
npm run build
npm ci --production

# Create tar.gz
cd dist
cp -R ../node_modules ./
tar czvf ../_temp/actions-yaml.tar.gz *