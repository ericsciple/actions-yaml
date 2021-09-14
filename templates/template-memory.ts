import { MemoryCounter } from "../expressions/nodes"
import {
  BasicExpressionToken,
  BASIC_EXPRESSION_TYPE,
  BOOLEAN_TYPE,
  INSERT_EXPRESSION_TYPE,
  MAPPING_TYPE,
  NULL_TYPE,
  NUMBER_TYPE,
  SEQUENCE_TYPE,
  StringToken,
  STRING_TYPE,
  TemplateToken,
} from "./tokens"

/**
 * Tracks characteristics about the current memory usage (CPU, stack, size)
 */
export class TemplateMemory {
  private readonly _memoryCounter: MemoryCounter
  private readonly maxDepth: number
  private _currentDepth = 0
  public readonly maxBytes: number

  public constructor(maxDepth: number, maxBytes: number) {
    this._memoryCounter = new MemoryCounter(undefined, maxBytes)
    this.maxDepth = maxDepth
    this.maxBytes = maxBytes
  }

  public get currentBytes(): number {
    return this._memoryCounter.currentBytes
  }

  public addAmount(bytes: number): void {
    this._memoryCounter.addAmount(bytes)
  }

  public addString(value: string): void {
    this._memoryCounter.addString(value)
  }

  public addToken(value: TemplateToken, traverse: boolean): void {
    this._memoryCounter.addAmount(
      TemplateMemory.calculateTokenBytes(value, traverse)
    )
  }

  public subtractAmount(bytes: number): void {
    this._memoryCounter.subtractAmount(bytes)
  }

  public subtractToken(value: TemplateToken, traverse: boolean): void {
    this._memoryCounter.subtractAmount(
      TemplateMemory.calculateTokenBytes(value, traverse)
    )
  }

  public incrementDepth(): void {
    if (this._currentDepth + 1 > this.maxDepth) {
      throw new Error("Maximum object depth exceeded")
    }
    this._currentDepth++
  }

  public decrementDepth(): void {
    if (this._currentDepth === 0) {
      throw new Error("Depth may not be decremented below zero")
    }
    this._currentDepth--
  }

  private static calculateTokenBytes(
    value: TemplateToken,
    traverse: boolean
  ): number {
    let result = 0
    for (const item of TemplateToken.traverse(value, traverse)) {
      // This measurement doesn't have to be perfect
      // https://codeblog.jonskeet.uk/2011/04/05/of-memory-and-strings/
      switch (item.templateTokenType) {
        case NULL_TYPE:
        case BOOLEAN_TYPE:
        case NUMBER_TYPE:
          result += MemoryCounter.MIN_OBJECT_SIZE
          break
        case STRING_TYPE: {
          const stringToken = item as StringToken
          result +=
            MemoryCounter.MIN_OBJECT_SIZE +
            MemoryCounter.calculateStringBytes(stringToken.value)
          break
        }
        case SEQUENCE_TYPE:
        case MAPPING_TYPE:
        case INSERT_EXPRESSION_TYPE:
          // Min object size is good enough. Allows for base + a few fields.
          result += MemoryCounter.MIN_OBJECT_SIZE
          break
        case BASIC_EXPRESSION_TYPE: {
          const basicExpression = item as BasicExpressionToken
          result +=
            MemoryCounter.MIN_OBJECT_SIZE +
            MemoryCounter.calculateStringBytes(basicExpression.expression)
          break
        }
        default:
          throw new Error(`Unexpected template type '${item.templateTokenType}`)
      }
    }

    return result
  }
}
