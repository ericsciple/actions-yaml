import yargs from "yargs/yargs"
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

const args = yargs(process.argv.slice(2))
  .usage(
    `Usage: node dist/templates/cli.js [options]

    Validates and parses templates via stdin, optionally expanding variable expressions. Outputs to stdout`
  )
  .example(
    "$0 --no-expand-expressions >out.json <test/templates-input.json",
    "Validate and parse the input data test/templates-input.json, without expanding expressions, and redirect eoutput to out.json."
  )
  .options({
    "expand-expressions": {
      type: "boolean",
      default: true,
      description:
        "interpolate variable expressions of the form `${{context.var}}' with values from `context'",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "output formatted json to stdout",
    },
  })
  .strict()
  .parseSync()

const pretty = args.pretty
const expandExpressions = args.expandExpressions

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
