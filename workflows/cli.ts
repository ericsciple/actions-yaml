import { parseWorkflow } from "./workflow-parser"
import { TraceWriter } from "../templates/trace-writer"
import { File } from "./file"
import yargs from "yargs/yargs"
import { evaluateStrategy } from "./workflow-evaluator"
import { ContextData, DictionaryContextData } from "../expressions/context-data"
import { TemplateToken } from "../templates/tokens"
import { TemplateValidationError } from "../templates/template-context"

interface Input {
  batchId: string | null | undefined
  command: string
}

interface ParseWorkflowInput extends Input {
  entryFileName: string
  files: File[]
}

interface EvaluateStrategyInput extends Input {
  fileTable: string[]
  context: any
  token: any
}

interface Output {
  batchId: string | undefined
  log: string
  value: any
  errors: TemplateValidationError[]
}

const args = yargs(process.argv.slice(2))
  .usage(`Usage: node dist/workflows/cli.js [options]\n\n`)
  .example("$0 --pretty >out.json <test/workflow-parser-input.json", "")
  .options({
    pretty: {
      type: "boolean",
      default: false,
      description: "output formatted json to stdout",
    },
  })
  .strict()
  .parseSync()

const pretty = args.pretty

let buffer = ""
const delimiterPattern = /(^|\r?\n)---(\r?\n)/ // Might be more data
const lastDelimiterPattern = /(^|\r?\n)---(\r?\n|$)/ // No more data, trailing newline option

function execute(input: Input): void {
  const log: string[] = []
  const trace: TraceWriter = {
    info: (x) => log.push(x),
    verbose: (x) => {},
    error: (x) => log.push(x),
  }
  let value: any = undefined
  let errors: TemplateValidationError[]
  try {
    switch (input.command) {
      case "parse-workflow": {
        const parseWorkflowInput = input as ParseWorkflowInput
        const result = parseWorkflow(
          parseWorkflowInput.entryFileName,
          parseWorkflowInput.files,
          trace
        )
        value = result.value
        errors = result.errors
        break
      }
      case "evaluate-strategy": {
        const evaluateStrategyInput = input as EvaluateStrategyInput
        const result = evaluateStrategy(
          evaluateStrategyInput.fileTable,
          ContextData.fromDeserializedContextData(
            evaluateStrategyInput.context
          ) as DictionaryContextData,
          TemplateToken.fromDeserializedTemplateToken(
            evaluateStrategyInput.token
          ),
          trace
        )
        value = result.value
        errors = result.errors
        break
      }
      default:
        throw new Error(`Unsupported command '${input.command}'`)
    }
  } catch (err) {
    const message = (err as any).message ?? `${err}`
    const code = (err as any).code
    const stack = `${(err as any).stack}`
    const error = new TemplateValidationError(message, code)
    ;(error as any).stack = stack
    errors = [error]
  }
  const output = <Output>{
    batchId: input.batchId ?? undefined,
    log: log.join("\n"),
    value: value,
    errors: errors,
  }
  console.log(JSON.stringify(output, undefined, pretty ? "  " : undefined))
  console.log("---")
}

function processBuffer(last: boolean): void {
  for (;;) {
    // Match delimiter
    const match = buffer.match(last ? lastDelimiterPattern : delimiterPattern)

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
      execute(input)
    }
  }
}

process.stdin.on("data", (data: Buffer) => {
  buffer += data.toString()
  processBuffer(false)
})
process.stdin.on("end", () => {
  processBuffer(true)
  _resolve(undefined)
})

let _resolve: (value: void) => void
async function run(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    _resolve = resolve
  })
}
run()
