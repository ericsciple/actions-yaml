#!/bin/bash

die() {
  echo "$*" 1>&2
  exit 1
}

# set -x # print each line as it's executed
set -e # exit at the first error

mkdir -p _temp

echo 'Testing CLI'
set +e
# unknown flags should print usage and return error
node dist/templates/cli.js --wat >_temp/cli-unknown-option.actual.json 2>&1
[[ "$?" == 1 ]] || die "unexpected return status '$?'"
grep -q "Error: Unknown option 'wat'" _temp/cli-unknown-option.actual.json

# `--help` should print usage
node dist/templates/cli.js --help >_temp/cli-help.actual.json 2>&1
grep -q "Usage:" _temp/cli-help.actual.json
echo 'Success'
set -e

echo 'Testing expressions'
node dist/expressions/cli.js --pretty >_temp/expressions.actual.json 2>&1 <test/expressions-input.json
diff test/expressions.expected.json _temp/expressions.actual.json
echo 'Success'

echo 'Testing template reader with --expand-expressions'
node dist/templates/cli.js --pretty >_temp/templates.actual.json 2>&1 <test/templates-input.json
diff test/templates.expected.json _temp/templates.actual.json
echo 'Success'

echo 'Testing template reader with --no-expand-expressions'
node dist/templates/cli.js --pretty --no-expand-expressions >_temp/templates-no-expand.actual.json 2>&1 <test/templates-input.json
diff test/templates.expected.json _temp/templates-no-expand.actual.json
echo 'Success'

echo 'Testing workflow parser'
node dist/workflows/cli.js --pretty >_temp/workflow-parser.actual.json 2>&1 <test/workflow-parser-input.json
diff test/workflow-parser.expected.json _temp/workflow-parser.actual.json
echo 'Success'
