import { promisify } from "util"
import { parseArgs } from "./command-line-args"
import { ContextData } from "./context-data"
import { SimpleNamedContextNode } from "./nodes"
import { createExpressionTree, NamedContextInfo } from "./parser"
import { TraceWriter } from "./trace-writer"

interface Input {
  batchId: string | null | undefined
  context: { [key: string]: any }
  expressions: string[]
}

interface Output {
  batchId: string | undefined
  sequence: number
  log: string
  result: any
  errorMessage: string
  errorCode: string
}

const args = parseArgs(["pretty"], [], false)
const pretty = args.flags["pretty"] ?? false

let buffer = ""
const delimiterPattern = /(^|\r?\n)---(\r?\n)/ // Might be more data
const lastDelimiterPattern = /(^|\r?\n)---(\r?\n|$)/ // No more data, trailing newline option

function evaluate(input: Input): void {
  const contexts: NamedContextInfo[] = []
  for (const key of Object.keys(input.context ?? {})) {
    contexts.push(<NamedContextInfo>{
      name: key,
      createNode: () =>
        new SimpleNamedContextNode(ContextData.fromObject(input.context[key])),
    })
  }
  for (let i = 0; i < (input.expressions ?? []).length; i++) {
    const log: string[] = []
    let result: any = undefined
    let errorMessage: string | undefined
    let errorCode: string | undefined
    try {
      const expression = input.expressions[i]
      const trace: TraceWriter = {
        info: (x) => log.push(x),
        verbose: (x) => {},
      }
      const tree = createExpressionTree(expression, undefined, contexts)
      if (tree) {
        const evaluationResult = tree.evaluateTree(trace)
        result = evaluationResult.isPrimitive
          ? evaluationResult.value
          : ContextData.toObject(evaluationResult.value as ContextData)
      } else {
        errorMessage = "No expression defined"
      }
    } catch (err) {
      errorMessage = (err as any).message ?? `${err}`
      errorCode = (err as any).code
    }
    const output = <Output>{
      batchId: input.batchId ?? undefined,
      sequence: i,
      log: log.join("\n"),
      result: result,
      errorMessage: errorMessage,
      errorCode: errorCode,
    }
    console.log(JSON.stringify(output, undefined, pretty ? "  " : undefined))
    console.log("---")
  }
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
      evaluate(input)
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
