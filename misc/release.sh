#!/bin/bash

set -e
mkdir -p _temp
rm _temp/actions.yaml.tar.xz || true
cd dist
tar cvJf ../_temp/actions-yaml.tar.xz *