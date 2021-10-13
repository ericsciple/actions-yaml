#!/usr/bin/env bats

load '../node_modules/bats-assert/load'

@test "Expressions CLI" {
  run node dist/expressions/cli.js --pretty <test/expressions-input.json
  assert_output <test/expressions.expected.json
}

@test 'Templates CLI' {
  run node dist/templates/cli.js --pretty <test/templates-input.json
  assert_output <test/templates.expected.json
}

@test "Templates CLI with unknown flag" {
  run node dist/templates/cli.js --wat
  assert_output --partial  "Error: Unknown option 'wat'"
  assert_failure
}

@test "Templates CLI with --help" {
  run node dist/templates/cli.js --help
  assert_output --partial  "Usage:"
  assert_failure # this should really exit 0
}

@test 'Templates CLI with --no-expand-expressions' {
  run node dist/templates/cli.js --pretty --no-expand-expressions <test/templates-input.json
  assert_output <test/templates.expected.json
}

@test 'Workflows CLI' {
  run node dist/workflows/cli.js --pretty <test/workflow-parser-input.json
  assert_output <test/workflow-parser.expected.json
}
