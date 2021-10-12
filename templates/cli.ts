import { TraceWriter } from "./trace-writer"
import {
  TemplateContext,
  TemplateValidationError,
  TemplateValidationErrors,
} from "./template-context"
import { TemplateToken } from "./tokens"
import { TemplateMemory } from "./template-memory"
import { TemplateSchema } from "./schema"
import { JSONObjectReader } from "./json-object-reader"
import { readTemplate } from "./template-reader"
import { evaluateTemplate } from "./template-evaluator"
import { parseArgs } from "../expressions/command-line-args"

const usage = `\
Usage: node dist/templates/cli.js [options] <input.json

Validates and parses templates, optionally expanding variable expressions.

Input templates/context are supplied to stdin as json objects.
Parsed and expanded templates (or errors) are printed to stdout as a json object.

Options:
  --[no-]expand-expressions
    If \`--expand-expressions' (default), validate template schema *and* expand
    variable expressions of the form $\{{context.variable}}, interpolating with
    values found in the \`context' data supplied from stdin.
    If \`--no-expand-expressions', only validate template schema, outputting
    such expressions un-interpolated.

  --pretty
    print formatted json to stdout

  --help
    print this usage and exit

Examples:
  node dist/templates/cli.js --no-expand-expressions <test/templates-input.json
`

interface Input {
  batchId: string | null | undefined
  schema: string
  templates: Template[]
}

interface Template {
  type: string
  content: string
}

interface Output {
  batchId: string | undefined
  sequence: number
  log: string
  result: TemplateToken | undefined
  errors: TemplateValidationError[] | undefined
}

const args = parseArgs(
  ["pretty", "expand-expressions", "no-expand-expressions"],
  [],
  false,
  usage
)
const pretty = args.flags["pretty"] ?? false
let expandExpressions = true

if (args.flags["expand-expressions"] && args.flags["no-expand-expressions"]) {
  console.error(
    "You can't provide both `--expand-expressions' and `--no-expand-expressions'"
  )
  process.exit()
} else if (args.flags["no-expand-expressions"]) {
  expandExpressions = false
}

let buffer = ""
const delimiterPattern = /(^|\r?\n)---(\r?\n)/

function evaluate(input: Input): void {
  const schema = TemplateSchema.load(
    new JSONObjectReader(undefined, input.schema)
  )
  for (let i = 0; i < input.templates.length; i++) {
    const template = input.templates[i]
    const log: string[] = []
    const trace: TraceWriter = {
      info: (x) => log.push(x),
      verbose: (x) => {},
      error: (x) => log.push(x),
    }
    const context = new TemplateContext(
      new TemplateValidationErrors(),
      new TemplateMemory(50, 1048576),
      schema,
      trace
    )
    const readResult = readTemplate(
      context,
      template.type,
      new JSONObjectReader(undefined, template.content),
      undefined
    )
    let value: TemplateToken | undefined = readResult.value
    // if (context.errors.count === 0 && expandExpressions) {
    if (expandExpressions) {
      value = evaluateTemplate(
        context,
        template.type,
        readResult.value,
        readResult.bytes,
        undefined
      )
    }
    const output = <Output>{
      batchId: input.batchId ?? undefined,
      sequence: i,
      log: log.join("\n"),
      result: value,
      errors: context.errors.getErrors(),
    }
    console.log(JSON.stringify(output, undefined, pretty ? "  " : undefined))
    console.log("---")
  }
}

function processBuffer(): void {
  for (;;) {
    // Match delimiter
    const match = buffer.match(delimiterPattern)

    // No delimiter
    if (!match) {
      break
    }

    // Adjust buffer
    const inputString = buffer.substr(0, match.index)
    buffer = buffer.substr(match.index! + match[0].length)

    // Evaluate
    if (inputString.trim()) {
      const input = JSON.parse(inputString) as Input
      evaluate(input)
    }
  }
}

process.stdin.on("data", (data: Buffer) => {
  buffer += data.toString()
  processBuffer()
})
process.stdin.on("end", () => {
  processBuffer()
})
