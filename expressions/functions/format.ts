import {
  CoreResult,
  EvaluationContext,
  EvaluationResult,
  FunctionNode,
  MemoryCounter,
} from "../nodes"

export class Format extends FunctionNode {
  public override evaluateCore(context: EvaluationContext): CoreResult {
    const format = this.parameters[0].evaluate(context).convertToString()
    let index = 0
    const result = new FormatResultBuilder(
      this,
      context,
      this.createMemoryCounter(context)
    )
    while (index < format.length) {
      const lbrace = format.indexOf("{", index)
      let rbrace = format.indexOf("}", index)

      // Left brace
      if (lbrace >= 0 && (rbrace < 0 || rbrace > lbrace)) {
        // Escaped left brace
        if (Format.safeCharAt(format, lbrace + 1) === "{") {
          result.appendString(format.substr(index, lbrace - index + 1))
          index = lbrace + 2
          continue
        }

        // Left brace, number, optional format specifiers, right brace
        if (rbrace > lbrace + 1) {
          const argIndex = Format.readArgIndex(format, lbrace + 1)
          if (argIndex.success) {
            const formatSpecifiers = Format.readFormatSpecifiers(
              format,
              argIndex.endIndex + 1
            )
            if (formatSpecifiers.success) {
              rbrace = formatSpecifiers.rbrace

              // Check parameter count
              if (argIndex.result > this.parameters.length - 2) {
                throw new Error(
                  `The following format string references more arguments than were supplied: ${format}`
                )
              }

              // Append the portion before the left brace
              if (lbrace > index) {
                result.appendString(format.substr(index, lbrace - index))
              }

              // Append the arg
              result.appendArgument(argIndex.result, formatSpecifiers.result)
              index = rbrace + 1
              continue
            }
          }
        }

        throw new Error(`The following format string is invalid: ${format}`)
      }
      // Right brace
      else if (rbrace >= 0) {
        // Escaped right brace
        if (Format.safeCharAt(format, rbrace + 1) === "}") {
          result.appendString(format.substr(index, rbrace - index + 1))
          index = rbrace + 2
        } else {
          throw new Error(`The following format string is invalid: ${format}`)
        }
      }
      // Last segment
      else {
        result.appendString(format.substr(index))
        break
      }
    }

    return <CoreResult>{
      value: result.build(),
      memory: undefined,
    }
  }

  public static format(
    memoryCounter: MemoryCounter,
    format: string,
    args: any[]
  ): string {
    const result: string[] = []
    let index = 0
    while (index < format.length) {
      const lbrace = format.indexOf("{", index)
      let rbrace = format.indexOf("}", index)

      // Left brace
      if (lbrace >= 0 && (rbrace < 0 || rbrace > lbrace)) {
        // Escaped left brace
        if (Format.safeCharAt(format, lbrace + 1) === "{") {
          result.push(format.substr(index, lbrace - index + 1))
          memoryCounter.addString(result[result.length - 1])
          index = lbrace + 2
          continue
        }

        // Left brace, number, optional format specifiers, right brace
        if (rbrace > lbrace + 1) {
          const argIndex = Format.readArgIndex(format, lbrace + 1)
          if (argIndex.success) {
            const formatSpecifiers = Format.readFormatSpecifiers(
              format,
              argIndex.endIndex + 1
            )
            if (formatSpecifiers.success) {
              if (formatSpecifiers.result) {
                throw new Error("Format specifies not currently supported")
              }

              rbrace = formatSpecifiers.rbrace

              // Check parameter count
              if (argIndex.result > args.length - 1) {
                throw new Error(
                  `The following format string references more arguments than were supplied: ${format}`
                )
              }

              // Append the portion before the left brace
              if (lbrace > index) {
                result.push(format.substr(index, lbrace - index))
                memoryCounter.addString(result[result.length - 1])
              }

              // Append the arg
              result.push(`${args[argIndex.result]}`)
              memoryCounter.addString(result[result.length - 1])
              index = rbrace + 1
              continue
            }
          }
        }

        throw new Error(`The following format string is invalid: ${format}`)
      }
      // Right brace
      else if (rbrace >= 0) {
        // Escaped right brace
        if (Format.safeCharAt(format, rbrace + 1) === "}") {
          result.push(format.substr(index, rbrace - index + 1))
          memoryCounter.addString(result[result.length - 1])
          index = rbrace + 2
        } else {
          throw new Error(`The following format string is invalid: ${format}`)
        }
      }
      // Last segment
      else {
        result.push(format.substr(index))
        memoryCounter.addString(result[result.length - 1])
        break
      }
    }

    return result.join("")
  }

  private static readArgIndex(string: string, startIndex: number): ArgIndex {
    // Count the number of digits
    let length = 0
    while (true) {
      const nextChar = Format.safeCharAt(string, startIndex + length)
      if (nextChar >= "0" && nextChar <= "9") {
        length++
      } else {
        break
      }
    }

    // Validate at least one digit
    if (length < 1) {
      return <ArgIndex>{
        success: false,
      }
    }

    // Parse the number
    const endIndex = startIndex + length - 1
    const result = parseInt(string.substr(startIndex, length))
    return <ArgIndex>{
      success: !isNaN(result),
      result: result,
      endIndex: endIndex,
    }
  }

  private static readFormatSpecifiers(
    string: string,
    startIndex: number
  ): FormatSpecifiers {
    // No format specifiers
    let c = Format.safeCharAt(string, startIndex)
    if (c === "}") {
      return <FormatSpecifiers>{
        success: true,
        result: "",
        rbrace: startIndex,
      }
    }

    // Validate starts with ":"
    if (c !== ":") {
      return <FormatSpecifiers>{
        success: false,
        result: "",
        rbrace: 0,
      }
    }

    // Read the specifiers
    const specifiers = []
    let index = (startIndex = 1)
    while (true) {
      // Validate not the end of the string
      if (index >= string.length) {
        return <FormatSpecifiers>{
          success: false,
          result: "",
          rbrace: 0,
        }
      }

      c = string[index]

      // Not right-brace
      if (c !== "}") {
        specifiers.push(c)
        index++
      }
      // Escaped right-brace
      else if (Format.safeCharAt(string, index + 1) === "}") {
        specifiers.push("}")
        index += 2
      }
      // Closing right-brace
      else {
        return <FormatSpecifiers>{
          success: true,
          result: specifiers.join(""),
          rbrace: index,
        }
      }
    }
  }

  private static safeCharAt(string: string, index: number): string {
    if (string.length > index) {
      return string[index]
    }

    return "\0"
  }
}

interface ArgIndex {
  success: boolean
  result: number
  endIndex: number
}

interface FormatSpecifiers {
  success: boolean
  result: string
  rbrace: number
}

class FormatResultBuilder {
  private readonly _node: Format
  private readonly _context: EvaluationContext
  private readonly _counter: MemoryCounter
  private readonly _cache: (ArgValue | undefined)[] = []
  private readonly _segments: (string | LazyString)[] = []

  public constructor(
    node: Format,
    context: EvaluationContext,
    counter: MemoryCounter
  ) {
    this._node = node
    this._context = context
    this._counter = counter
    while (this._cache.length < node.parameters.length - 1) {
      this._cache.push(undefined)
    }
  }

  public build(): string {
    // Build the final string. This is when lazy segments are evaluated.
    return this._segments
      .map((x) =>
        (x as LazyString | undefined)?.isLazyString === true
          ? (x as LazyString).value
          : (x as string)
      )
      .join("")
  }

  // Append a static value
  public appendString(value: string): void {
    if (value.length > 0) {
      // Track memory
      this._counter.addString(value)

      // Append the segment
      this._segments.push(value)
    }
  }

  // Append an argument
  public appendArgument(argIndex: number, formatSpecifiers: string): void {
    // Delay execution until the .build() is called
    this._segments.push(
      new LazyString(() => {
        let result: string

        // Get the arg from the cache
        let argValue = this._cache[argIndex]

        // Evaluate the arg and cache the result
        if (argValue === undefined) {
          // The evaluation result is required when format specifiers are used. Otherwise the string
          // result is required. Go ahead and store both values. Since convertToString() produces tracing,
          // we need to run that now so the tracing appears in order in the log.
          const evaluationResult = this._node.parameters[argIndex + 1].evaluate(
            this._context
          )
          const stringResult = evaluationResult.convertToString()
          argValue = <ArgValue>{
            evaluationResult,
            stringResult,
          }
          this._cache[argIndex] = argValue
        }

        // No format specifiers
        if (!formatSpecifiers) {
          result = argValue.stringResult
        }
        // Invalid
        else {
          throw new Error(
            `The format specifiers '${formatSpecifiers}' are not valid for objects of type '${argValue.evaluationResult.kind}'`
          )
        }

        // Track memory
        if (result) {
          this._counter.addString(result)
        }

        return result
      })
    )
  }
}

class LazyString {
  private readonly _getValue: () => string
  private _value: string | undefined
  public readonly isLazyString = true

  public constructor(getValue: () => string) {
    this._getValue = getValue
  }

  public get value(): string {
    if (this._value === undefined) {
      this._value = this._getValue()
    }

    return this._value
  }
}

/**
 * Stores an EvaluationResult and the value conveerted to a string
 */
interface ArgValue {
  evaluationResult: EvaluationResult
  stringResult: string
}
