#!/bin/bash

set -e
mkdir -p _temp
rm _temp/actions.yaml.tar.gz || true

npm ci --production

cd dist
rm -rf node_modules || true
cp -R ../node_modules ./
tar czvf ../_temp/actions-yaml.tar.gz *