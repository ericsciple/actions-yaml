#!/usr/bin/env bats

load '../node_modules/bats-support/load'
load '../node_modules/bats-assert/load'
mkdir -p _temp

@test "Expressions CLI" {
  node dist/expressions/cli.js --pretty < test/data/expressions.input.json > _temp/expressions.actual.json
  run node dist/expressions/cli.js --pretty < test/data/expressions.input.json
  assert_success
  cat test/data/expressions.expected.json | assert_output -
}

@test 'Templates CLI' {
  node dist/templates/cli.js --pretty < test/data/templates.input.json > _temp/templates.actual.json
  run node dist/templates/cli.js --pretty < test/data/templates.input.json
  assert_success
  cat test/data/templates.expected.json | assert_output -
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
  run node dist/templates/cli.js --pretty --no-expand-expressions <test/data/templates.input.json
  assert_success
  cat test/data/templates.expected.json | assert_output -
}

@test 'Parse workflow' {
  test/substitute.js test/data/parse-workflow.input.json _temp/parse-workflow.input.json test/data/substitute/WORKFLOW_PARSER_*
  node dist/workflows/cli.js --pretty < _temp/parse-workflow.input.json > _temp/parse-workflow.actual.json
  run node dist/workflows/cli.js --pretty < _temp/parse-workflow.input.json
  assert_success
  cat test/data/parse-workflow.expected.json | assert_output -
}

@test 'Evaluate strategy' {
  test/substitute.js test/data/evaluate-strategy.input.json _temp/evaluate-strategy.input.json test/data/substitute/EVALUATE_STRATEGY_*
  node dist/workflows/cli.js --pretty < _temp/evaluate-strategy.input.json > _temp/evaluate-strategy.actual.json
  run node dist/workflows/cli.js --pretty < _temp/evaluate-strategy.input.json
  assert_success
  cat test/data/evaluate-strategy.expected.json | assert_output -
}
