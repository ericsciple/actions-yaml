#!/usr/bin/env bats

load '../node_modules/bats-support/load'
load '../node_modules/bats-assert/load'
mkdir -p _temp

@test "Expressions CLI" {
  run node dist/expressions/cli.js --pretty <test/expressions-input.json
  assert_success
  cat test/expressions.expected.json | assert_output -
}

@test 'Templates CLI' {
  run node dist/templates/cli.js --pretty <test/templates-input.json
  assert_success
  cat test/templates.expected.json | assert_output -
}

@test "Templates CLI with unknown flag" {
  run node dist/templates/cli.js --wat
  assert_failure
  assert_output --partial  "Unknown argument: wat"
}

@test "Templates CLI with --help" {
  run node dist/templates/cli.js --help
  assert_success
  assert_output --partial  "Usage:"
}

@test 'Templates CLI with --no-expand-expressions' {
  run node dist/templates/cli.js --pretty --no-expand-expressions <test/templates-input.json
  assert_success
  cat test/templates.expected.json | assert_output -
}

@test 'Workflows CLI' {
  export BATCH_1_FILE_1="$(test/json-encode.js test/workflow-parser-input.batch-1-file-1.yml)"
  export BATCH_2_FILE_1="$(test/json-encode.js test/workflow-parser-input.batch-2-file-1.yml)"
  cat test/workflow-parser-input.json | envsubst >_temp/workflow-parser-input.json
  run node dist/workflows/cli.js --pretty <_temp/workflow-parser-input.json
  assert_success
  cat test/workflow-parser.expected.json | assert_output -
}
