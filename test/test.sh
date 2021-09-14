#!/bin/bash

set -e

mkdir -p _temp

echo 'Testing expressions'
node dist/expressions/cli.js --pretty >_temp/expressions.actual.json 2>&1 <test/expressions-input.json
diff test/expressions.expected.json _temp/expressions.actual.json
echo 'Success'

echo 'Testing template reader'
node dist/templates/cli.js --pretty >_temp/templates.actual.json 2>&1 <test/templates-input.json
diff test/templates.expected.json _temp/templates.actual.json
echo 'Success'