#!/bin/bash

set -e
mkdir -p _temp
rm _temp/actions.yaml.tar.gz || true
cd dist
tar czvf ../_temp/actions-yaml.tar.gz *