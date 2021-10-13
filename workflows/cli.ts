import { parseWorkflow } from "./workflow-parser"
import { TraceWriter } from "../templates/trace-writer"
import { File } from "./file"
import yargs from "yargs/yargs"

interface Input {
  batchId: string | null | undefined
  command: string
}

interface ParseWorkflowInput extends Input {
  entryFileId: string
  files: File[]
}

interface Output {
  batchId: string | undefined
  log: string
  result: any
  errorMessage: string
  errorCode: string
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
  let result: any = undefined
  let errorMessage: string | undefined
  let errorStack: string | undefined
  let errorCode: string | undefined
  try {
    switch (input.command) {
      case "parse-workflow": {
        const parseWorkflowInput = input as ParseWorkflowInput
        result = parseWorkflow(
          parseWorkflowInput.entryFileId,
          parseWorkflowInput.files,
          trace
        )
        break
      }
      default:
        throw new Error(`Unsupported command '${input.command}'`)
    }
  } catch (err) {
    errorMessage = (err as any).message ?? `${err}`
    errorStack = `${(err as any).stack}`
    errorCode = (err as any).code
  }
  const output = <Output>{
    batchId: input.batchId ?? undefined,
    log: log.join("\n"),
    result: result,
    errorMessage: errorMessage,
    errorStack: errorStack,
    errorCode: errorCode,
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
