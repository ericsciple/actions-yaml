import { TemplateContext } from "./template-context"
import {
  createExpressionTree,
  validateExpressionSyntax,
  FunctionInfo,
  NamedContextInfo,
} from "../expressions/parser"
import {
  AbstractExpressionNode,
  BooleanCompatible,
  CanonicalValue,
  ContainerNode,
  CoreResult,
  EvaluationContext,
  EvaluationOptions,
  EvaluationResult,
  FunctionNode,
  LiteralNode,
  MemoryCounter,
  NodeType,
  NullCompatible,
  NumberCompatible,
  ReadOnlyArrayCompatible,
  ReadOnlyObjectCompatible,
  SimpleNamedContextNode,
  StringCompatible,
  ValueKind,
} from "../expressions/nodes"
import { Format } from "../expressions/functions/format"
import {
  CLOSE_EXPRESSION,
  INSERT_DIRECTIVE,
  MAX_CONSTANT,
  OPEN_EXPRESSION,
} from "./template-constants"
import {
  END_PARAMETER,
  START_PARAMETER,
} from "../expressions/expression-constants"

export const STRING_TYPE = 0
export const SEQUENCE_TYPE = 1
export const MAPPING_TYPE = 2
export const BASIC_EXPRESSION_TYPE = 3
export const INSERT_EXPRESSION_TYPE = 4
export const BOOLEAN_TYPE = 5
export const NUMBER_TYPE = 6
export const NULL_TYPE = 7

/**
 * Interface for reading a source object (or file).
 * This interface is used by TemplateReader to build a TemplateToken DOM.
 */
export interface ObjectReader {
  allowLiteral(): LiteralToken | undefined

// maybe rename these since we don't have out params
  allowSequenceStart(): SequenceToken | undefined

  allowSequenceEnd(): boolean

  allowMappingStart(): MappingToken | undefined

  allowMappingEnd(): boolean

  validateStart(): void

  validateEnd(): void
}

export abstract class TemplateToken {
  // Fields for serialization
  private readonly type: number
  public readonly file: number | undefined
  public readonly line: number | undefined
  public readonly col: number | undefined

  /**
   * Base class for all template tokens
   */
  public constructor(
    type: number,
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
  ) {
    this.type = type
    this.file = file
    this.line = line
    this.col = col
  }

  public get templateTokenType(): number {
    return this.type
  }

  public abstract get isScalar(): boolean

  public abstract get isLiteral(): boolean

  public abstract get isExpression(): boolean

  public abstract clone(omitSource?: boolean): TemplateToken

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertNull(objectDescription: string): NullToken {
    if (this.type === NULL_TYPE) {
      return this as unknown as NullToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. The type '${NULL_TYPE}' was expected.`
    )
  }

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertBoolean(objectDescription: string): BooleanToken {
    if (this.type === BOOLEAN_TYPE) {
      return this as unknown as BooleanToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. The type '${BOOLEAN_TYPE}' was expected.`
    )
  }

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertNumber(objectDescription: string): NumberToken {
    if (this.type === NUMBER_TYPE) {
      return this as unknown as NumberToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. The type '${NUMBER_TYPE}' was expected.`
    )
  }

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertString(objectDescription: string): StringToken {
    if (this.type === STRING_TYPE) {
      return this as unknown as StringToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. The type '${STRING_TYPE}' was expected.`
    )
  }

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertScalar(objectDescription: string): ScalarToken {
    if ((this as unknown as ScalarToken | undefined)?.isScalar === true) {
      return this as unknown as ScalarToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. A scalar type was expected.`
    )
  }

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertSequence(objectDescription: string): SequenceToken {
    if (this.type === SEQUENCE_TYPE) {
      return this as unknown as SequenceToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. The type '${SEQUENCE_TYPE}' was expected.`
    )
  }

  /**
   * Asserts expected type and throws a good debug message if unexpected
   */
  public assertMapping(objectDescription: string): MappingToken {
    if (this.type === MAPPING_TYPE) {
      return this as unknown as MappingToken
    }

    throw new Error(
      `Unexpected type '${this.type}' encountered while reading '${objectDescription}'. The type '${MAPPING_TYPE}' was expected.`
    )
  }

  /**
   * Converts to TemplateToken from serialized Template that has already been JSON-parsed into regular JavaScript objects.
   */
  public static fromDeserializedTemplateToken(object: any): TemplateToken {
    switch (typeof object) {
      case "boolean":
        return new BooleanToken(
          undefined,
          undefined,
          undefined,
          object as boolean
        )
      case "number":
        return new NumberToken(
          undefined,
          undefined,
          undefined,
          object as number
        )
      case "string":
        return new StringToken(
          undefined,
          undefined,
          undefined,
          object as string
        )
      case "object": {
        if (object === null) {
          return new NullToken(undefined, undefined, undefined)
        }

        const type = (object.type as number | undefined) ?? STRING_TYPE
        const file = object.file as number | undefined
        const line = object.line as number | undefined
        const col = object.col as number | undefined
        switch (type) {
          case NULL_TYPE:
            return new NullToken(file, line, col)
          case BOOLEAN_TYPE: {
            return new BooleanToken(file, line, col, object.bool ?? false)
          }
          case NUMBER_TYPE: {
            return new NumberToken(file, line, col, object.num ?? 0)
          }
          case STRING_TYPE: {
            return new StringToken(file, line, col, object.lit ?? "")
          }
          case SEQUENCE_TYPE: {
            const sequence = new SequenceToken(file, line, col)
            for (const item of object.seq ?? []) {
              sequence.add(TemplateToken.fromDeserializedTemplateToken(item))
            }
            return sequence
          }
          case MAPPING_TYPE: {
            const mapping = new MappingToken(file, line, col)
            for (const pair of object.map ?? []) {
              mapping.add(
                TemplateToken.fromDeserializedTemplateToken(
                  pair.key
                ) as ScalarToken,
                TemplateToken.fromDeserializedTemplateToken(pair.value)
              )
            }
            return mapping
          }
          case BASIC_EXPRESSION_TYPE:
            return new BasicExpressionToken(file, line, col, object.expr ?? "")
          case INSERT_EXPRESSION_TYPE:
            return new InsertExpressionToken(file, line, col)
          default:
            throw new Error(
              `Unexpected type '${type}' when converting deserialized template token to template token`
            )
        }
      }
      default:
        throw new Error(
          `Unexpected type '${typeof object}' when converting deserialized template token to template token`
        )
    }
  }

  /**
   * Returns all tokens (depth first)
   * @param value The object to travese
   * @param omitKeys Whether to omit mapping keys
   */
  public static *traverse(
    value: TemplateToken,
    omitKeys?: boolean
  ): Generator<TemplateToken, void> {
    yield value
    switch (value.templateTokenType) {
      case SEQUENCE_TYPE:
      case MAPPING_TYPE: {
        let state: TraversalState | undefined = new TraversalState(
          undefined,
          value
        )
        while (state) {
          if (state.moveNext(omitKeys ?? false)) {
            value = state.current as TemplateToken
            yield value

            switch (value.type) {
              case SEQUENCE_TYPE:
              case MAPPING_TYPE:
                state = new TraversalState(state, value)
                break
            }
          } else {
            state = state.parent
          }
        }
        break
      }
    }
  }
}

/**
 * Base class for everything that is not a mapping or sequence
 */
export abstract class ScalarToken extends TemplateToken {
  public constructor(
    type: number,
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
  ) {
    super(type, file, line, col)
  }

  public abstract toString(): string

  public abstract toDisplayString(): string

  public override get isScalar(): boolean {
    return true
  }

  protected static trimDisplayString(displayString: string): string {
    let firstLine = displayString.trimStart()
    const firstNewLine = firstLine.indexOf("\n")
    const firstCarriageReturn = firstLine.indexOf("\r")
    if (firstNewLine >= 0 || firstCarriageReturn >= 0) {
      firstLine = firstLine.substr(
        0,
        Math.min(
          firstNewLine >= 0 ? firstNewLine : Number.MAX_VALUE,
          firstCarriageReturn >= 0 ? firstCarriageReturn : Number.MAX_VALUE
        )
      )
    }
    return firstLine
  }
}

export abstract class LiteralToken extends ScalarToken {
  public constructor(
    type: number,
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
  ) {
    super(type, file, line, col)
  }

  public override get isLiteral(): boolean {
    return true
  }

  public override get isExpression(): boolean {
    return false
  }

  public override toDisplayString(): string {
    return ScalarToken.trimDisplayString(this.toString())
  }

  /**
   * Throws a good debug message when an unexpected literal value is encountered
   */
  public assertUnexpectedValue(objectDescription: string): void {
    throw new Error(
      `Error while reading '${objectDescription}'. Unexpected value '${this.toString()}'`
    )
  }
}

export class NullToken extends LiteralToken implements NullCompatible {
  public constructor(
<<<<<<< HEAD
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
=======
    fileId?: number | undefined,
    line?: number | undefined,
    col?: number | undefined
>>>>>>> acf5623 (WIP)
  ) {
    super(NULL_TYPE, file, line, col)
  }

  public get compatibleValueKind(): ValueKind {
    return ValueKind.Null
  }

  public override clone(omitSource?: boolean): TemplateToken {
    return omitSource
      ? new NullToken(undefined, undefined, undefined)
      : new NullToken(this.file, this.line, this.col)
  }

  public override toString(): string {
    return ""
  }
}

export class BooleanToken extends LiteralToken implements BooleanCompatible {
  private readonly bool: boolean

  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined,
    value: boolean
  ) {
    super(BOOLEAN_TYPE, file, line, col)
    this.bool = value
  }

  public get value(): boolean {
    return this.bool
  }

  public get compatibleValueKind(): ValueKind {
    return ValueKind.Boolean
  }

  public override clone(omitSource?: boolean): TemplateToken {
    return omitSource
      ? new BooleanToken(undefined, undefined, undefined, this.bool)
      : new BooleanToken(this.file, this.line, this.col, this.bool)
  }

  public override toString(): string {
    return this.bool ? "true" : "false"
  }

  /**
   * Required for interface BooleanCompatible
   */
  public getBoolean(): boolean {
    return this.bool
  }
}

export class NumberToken extends LiteralToken implements NumberCompatible {
  private readonly num: number

  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined,
    value: number
  ) {
    super(NUMBER_TYPE, file, line, col)
    this.num = value
  }

  public get value(): number {
    return this.num
  }

  public get compatibleValueKind(): ValueKind {
    return ValueKind.Number
  }

  public override clone(omitSource?: boolean): TemplateToken {
    return omitSource
      ? new NumberToken(undefined, undefined, undefined, this.num)
      : new NumberToken(this.file, this.line, this.col, this.num)
  }

  public override toString(): string {
    return `${this.num}`
  }

  /**
   * Required for interface NumberCompatible
   */
  public getNumber(): number {
    return this.num
  }
}

export class StringToken extends LiteralToken implements StringCompatible {
  private readonly lit: string

  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined,
    value: string
  ) {
    super(STRING_TYPE, file, line, col)
    this.lit = value
  }

  public get value(): string {
    return this.lit
  }

  public get compatibleValueKind(): ValueKind {
    return ValueKind.String
  }

  public override clone(omitSource?: boolean): TemplateToken {
    return omitSource
      ? new StringToken(undefined, undefined, undefined, this.lit)
      : new StringToken(this.file, this.line, this.col, this.lit)
  }

  public override toString(): string {
    return this.lit
  }

  /**
   * Required for interface StringCompatible
   */
  public getString(): string {
    return this.lit
  }
}

export abstract class ExpressionToken extends ScalarToken {
  private static readonly FUNCTION_REGEXP =
    /^([a-zA-Z0-9_]+)\(([0-9]+),([0-9]+|MAX)\)$/
  public readonly directive: string | undefined

  public constructor(
    type: number,
    file: number | undefined,
    line: number | undefined,
    col: number | undefined,
    directive: string | undefined
  ) {
    super(type, file, line, col)
    this.directive = directive
  }

  public override get isLiteral(): boolean {
    return false
  }

  public override get isExpression(): boolean {
    return true
  }

  public static validateExpression(
    expression: string,
    allowedContext: string[]
  ): void {
    // Create dummy named contexts and functions
    const namedContexts: NamedContextInfo[] = []
    const functions: FunctionInfo[] = []
    if (allowedContext.length > 0) {
      for (const contextItem of allowedContext) {
        const match = contextItem.match(ExpressionToken.FUNCTION_REGEXP)
        if (match) {
          const functionName = match[1]
          const minParameters = Number.parseInt(match[2])
          const maxParametersRaw = match[3]
          const maxParameters =
            maxParametersRaw === MAX_CONSTANT
              ? Number.MAX_SAFE_INTEGER
              : Number.parseInt(maxParametersRaw)
          functions.push(<FunctionInfo>{
            name: functionName,
            minParameters: minParameters,
            maxParameters: maxParameters,
            createNode: () => new DummyFunction(),
          })
        } else {
          namedContexts.push(<NamedContextInfo>{
            name: contextItem,
            createNode: () => new SimpleNamedContextNode(undefined),
          })
        }
      }
    }

    // Parse
    createExpressionTree(expression, undefined, namedContexts, functions)
  }
}

export class SequenceToken
  extends TemplateToken
  implements ReadOnlyArrayCompatible
{
  private readonly seq: TemplateToken[] = []

  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
  ) {
    super(SEQUENCE_TYPE, file, line, col)
  }

  public get count(): number {
    return this.seq.length
  }

  public override get isScalar(): boolean {
    return false
  }

  public override get isLiteral(): boolean {
    return false
  }

  public override get isExpression(): boolean {
    return false
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public get compatibleValueKind(): ValueKind {
    return ValueKind.Array
  }

  public add(value: TemplateToken): void {
    this.seq.push(value)
  }

  public get(index: number): TemplateToken {
    return this.seq[index]
  }

  public override clone(omitSource?: boolean): TemplateToken {
    const result = omitSource
      ? new SequenceToken(undefined, undefined, undefined)
      : new SequenceToken(this.file, this.line, this.col)
    for (const item of this.seq) {
      result.add(item.clone(omitSource))
    }
    return result
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public getArrayLength(): number {
    return this.seq.length
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public getArrayItem(index: number): any {
    return this.seq[index]
  }
}

export class MappingToken
  extends TemplateToken
  implements ReadOnlyObjectCompatible
{
  private readonly map: KeyValuePair[] = []

  // Properties that should not be serialized
  private readonly _getHiddenProperty: (
    propertyName: string,
    createDefaultValue: () => any
  ) => any
  private readonly _setHiddenProperty: (
    propertyName: string,
    value: any
  ) => void

  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
  ) {
    super(MAPPING_TYPE, file, line, col)

    this._getHiddenProperty = (
      propertyName: string,
      createDefaultValue: () => any
    ) => {
      const func = this._getHiddenProperty as any
      if (!Object.prototype.hasOwnProperty.call(func, propertyName)) {
        func[propertyName] = createDefaultValue()
      }
      return func[propertyName]
    }
    this._setHiddenProperty = (propertyName: string, value: any) => {
      const func = this._setHiddenProperty as any
      func[propertyName] = value
    }
  }

  public get count(): number {
    return this.map.length
  }

  public override get isScalar(): boolean {
    return false
  }

  public override get isLiteral(): boolean {
    return false
  }

  public override get isExpression(): boolean {
    return false
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public get compatibleValueKind(): ValueKind {
    return ValueKind.Object
  }

  public add(key: ScalarToken, value: TemplateToken): void {
    this.map.push(new KeyValuePair(key, value))
    this.clearDictionary()
  }

  public get(index: number): KeyValuePair {
    return this.map[index]
  }

  public remove(index: number): void {
    this.map.splice(index, 1)
    this.clearDictionary()
  }

  public override clone(omitSource?: boolean): TemplateToken {
    const result = omitSource
      ? new MappingToken(undefined, undefined, undefined)
      : new MappingToken(this.file, this.line, this.col)
    for (const item of this.map) {
      result.add(
        item.key.clone(omitSource) as ScalarToken,
        item.value.clone(omitSource)
      )
    }
    return result
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public hasObjectKey(key: string): boolean {
    this.initializeDictionary()
    const upperKey = key.toUpperCase()
    return Object.prototype.hasOwnProperty.call(
      this.getDictionaryIndexLookup(),
      upperKey
    )
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public getObjectKeys(): string[] {
    this.initializeDictionary()
    return this.getDictionaryPairs().map((x) => x.key)
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public getObjectKeyCount(): number {
    this.initializeDictionary()
    return this.getDictionaryPairs().length
  }

  /**
   * Required for interface ReadOnlyObjectCompatible
   */
  public getObjectValue(key: string): any {
    this.initializeDictionary()
    const upperKey = key.toUpperCase()
    const index = this.getDictionaryIndexLookup()[upperKey]
    if (index === undefined) {
      return undefined
    } else {
      return this.getDictionaryPairs()[index].value
    }
  }

  /**
   * Clears the dictionary used for the expressions interface ReadOnlyObjectCompatible
   */
  private clearDictionary(): void {
    this._setHiddenProperty("dictionaryPairs", [])
    this._setHiddenProperty("dictionaryIndexLookup", {})
  }

  /**
   * Gets the key value pairs used for the interface ReadOnlyObjectCompatible
   */
  private getDictionaryPairs(): StringKeyValuePair[] {
    return this._getHiddenProperty("dictionaryPairs", () => {
      return []
    }) as StringKeyValuePair[]
  }

  /**
   * Gets the index lookup used for the interface ReadOnlyObjectCompatible
   */
  private getDictionaryIndexLookup(): { [key: string]: number } {
    return this._getHiddenProperty("dictionaryIndexLookup", () => {
      return {}
    }) as { [key: string]: number }
  }

  /**
   * Initializes the dictionary used for the expressions interface ReadOnlyObjectCompatible
   */
  private initializeDictionary(): void {
    // Case insensitive dictionary already built?
    const pairs = this.getDictionaryPairs()
    if (pairs.length > 0) {
      return
    }

    // Build a case insensitive dictionary
    const indexLookup = this.getDictionaryIndexLookup()
    for (const pair of this.map) {
      if (pair.key.templateTokenType === STRING_TYPE) {
        const key = (pair.key as StringToken).value
        const upperKey = key.toUpperCase()
        if (indexLookup[upperKey] === undefined) {
          indexLookup[upperKey] = pairs.length
          pairs.push(new StringKeyValuePair(key, pair.value))
        }
      }
    }
  }
}

export class BasicExpressionToken extends ExpressionToken {
  private readonly expr: string

  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined,
    expression: string
  ) {
    super(BASIC_EXPRESSION_TYPE, file, line, col, undefined)
    this.expr = expression
  }

  public get expression(): string {
    return this.expr
  }

  public override clone(omitSource?: boolean): TemplateToken {
    return omitSource
      ? new BasicExpressionToken(undefined, undefined, undefined, this.expr)
      : new BasicExpressionToken(this.file, this.line, this.col, this.expr)
  }

  public override toString(): string {
    return `${OPEN_EXPRESSION} ${this.expr} ${CLOSE_EXPRESSION}`
  }

  public override toDisplayString(): string {
    let displayString = ""
    const expressionNode = validateExpressionSyntax(
      this.expr,
      undefined
    ) as AbstractExpressionNode
    if (
      expressionNode.nodeType === NodeType.Container &&
      expressionNode.name.toUpperCase() === "FORMAT"
    ) {
      // Make sure the first parameter is a literal string so we can format it
      const formatNode = expressionNode as ContainerNode
      if (
        formatNode.parameters.length > 1 &&
        formatNode.parameters[0].nodeType === NodeType.Literal &&
        (formatNode.parameters[0] as LiteralNode).kind === ValueKind.String
      ) {
        // Get the format args
        const formatArgs = formatNode.parameters
          .slice(1)
          .map((x) => BasicExpressionToken.convertToFormatArg(x))
        const memoryCounter = new MemoryCounter(undefined, 1048576) // 1mb
        try {
          displayString = Format.format(
            memoryCounter,
            (formatNode.parameters[0] as LiteralNode).value as string,
            formatArgs
          )
        } catch {
          // Intentionally empty.
          // If this operation fails, then revert to default display name.
        }
      }
    }
    return ScalarToken.trimDisplayString(displayString || this.toString())
  }

  public evaluateStringToken(context: TemplateContext): EvaluateTokenResult {
    const originalBytes = context.memory.currentBytes
    let value: TemplateToken
    const tree = createExpressionTree(
      this.expr,
      undefined,
      context.expressionNamedContexts,
      context.expressionFunctions
    )
    if (!tree) {
      throw new Error("Unexpected empty expression")
    }
    const options = new EvaluationOptions()
    options.maxMemory = context.memory.maxBytes
    const result = tree.evaluateTree(context.trace, context, options)
    if (result.isPrimitive) {
      value = this.createStringToken(context, result.convertToString())
    } else {
      context.error(this, "Expected a string")
      value = this.createStringToken(context, this.expr)
    }
    return new EvaluateTokenResult(
      value,
      context.memory.currentBytes - originalBytes
    )
  }

  public evaluateSequenceToken(context: TemplateContext): EvaluateTokenResult {
    const originalBytes = context.memory.currentBytes
    let value: TemplateToken
    const tree = createExpressionTree(
      this.expr,
      undefined,
      context.expressionNamedContexts,
      context.expressionFunctions
    )
    if (!tree) {
      throw new Error("Unexpected empty expression")
    }
    const options = new EvaluationOptions()
    options.maxMemory = context.memory.maxBytes
    const result = tree.evaluateTree(context.trace, context, options)
    value = this.convertToTemplateToken(context, result)
    if (value.templateTokenType !== SEQUENCE_TYPE) {
      context.error(this, "Expected a sequence")
      value = this.createSequenceToken(context)
    }
    return new EvaluateTokenResult(
      value,
      context.memory.currentBytes - originalBytes
    )
  }

  public evaluateMappingToken(context: TemplateContext): EvaluateTokenResult {
    const originalBytes = context.memory.currentBytes
    let value: TemplateToken
    const tree = createExpressionTree(
      this.expr,
      undefined,
      context.expressionNamedContexts,
      context.expressionFunctions
    )
    if (!tree) {
      throw new Error("Unexpected empty expression")
    }
    const options = new EvaluationOptions()
    options.maxMemory = context.memory.maxBytes
    const result = tree.evaluateTree(context.trace, context, options)
    value = this.convertToTemplateToken(context, result)
    if (value.templateTokenType !== MAPPING_TYPE) {
      context.error(this, "Expected a mapping")
      value = this.createMappingToken(context)
    }
    return new EvaluateTokenResult(
      value,
      context.memory.currentBytes - originalBytes
    )
  }

  public evaluateTemplateToken(context: TemplateContext): EvaluateTokenResult {
    const originalBytes = context.memory.currentBytes
    const tree = createExpressionTree(
      this.expr,
      undefined,
      context.expressionNamedContexts,
      context.expressionFunctions
    )
    if (!tree) {
      throw new Error("Unexpected empty expression")
    }
    const options = new EvaluationOptions()
    options.maxMemory = context.memory.maxBytes
    const result = tree.evaluateTree(context.trace, context, options)
    const value = this.convertToTemplateToken(context, result)
    return new EvaluateTokenResult(
      value,
      context.memory.currentBytes - originalBytes
    )
  }

  private convertToTemplateToken(
    context: TemplateContext,
    result: EvaluationResult
  ): TemplateToken {
    // Literal
    const literal = this.convertToLiteralToken(context, result)
    if (literal) {
      return literal
    }
    // Known raw types
    else if (result.raw !== null) {
      const type = (result.raw as TemplateToken | undefined)?.templateTokenType
      switch (type) {
        case SEQUENCE_TYPE:
        case MAPPING_TYPE: {
          const token = result.raw as TemplateToken
          context.memory.addToken(token, true)
          return token
        }
      }
    }

    // Leverage the expression SDK to traverse the object
    const collection = result.getCollectionInterface()
    switch (collection?.compatibleValueKind) {
      case ValueKind.Object: {
        const mapping = this.createMappingToken(context)
        const object = collection as ReadOnlyObjectCompatible
        for (const key of object.getObjectKeys()) {
          const keyToken = this.createStringToken(context, key)
          const valueResult = new EvaluationResult(
            new CanonicalValue(object.getObjectValue(key))
          )
          const valueToken = this.convertToTemplateToken(context, valueResult)
          mapping.add(keyToken, valueToken)
        }
        return mapping
      }
      case ValueKind.Array: {
        const sequence = this.createSequenceToken(context)
        const array = collection as ReadOnlyArrayCompatible
        const length = array.getArrayLength()
        for (let i = 0; i < length; i++) {
          const itemResult = new EvaluationResult(
            new CanonicalValue(array.getArrayItem(i))
          )
          const itemToken = this.convertToTemplateToken(context, itemResult)
          sequence.add(itemToken)
        }
        return sequence
      }
      default:
        throw new Error("Unable to convert the object to a template token")
    }
  }

  private convertToLiteralToken(
    context: TemplateContext,
    result: EvaluationResult
  ): LiteralToken | undefined {
    let literal: LiteralToken | undefined
    switch (result.kind) {
      case ValueKind.Null:
        literal = new NullToken(this.file, this.line, this.col)
        break
      case ValueKind.Boolean:
        literal = new BooleanToken(
          this.file,
          this.line,
          this.col,
          result.value as boolean
        )
        break
      case ValueKind.Number:
        literal = new NumberToken(
          this.file,
          this.line,
          this.col,
          result.value as number
        )
        break
      case ValueKind.String:
        literal = new StringToken(
          this.file,
          this.line,
          this.col,
          result.value as string
        )
        break
    }

    if (literal) {
      context.memory.addToken(literal, false)
    }

    return literal
  }

  private createStringToken(
    context: TemplateContext,
    value: string
  ): StringToken {
    const result = new StringToken(this.file, this.line, this.col, value)
    context.memory.addToken(result, false)
    return result
  }

  private createSequenceToken(context: TemplateContext): SequenceToken {
    const result = new SequenceToken(this.file, this.line, this.col)
    context.memory.addToken(result, false)
    return result
  }

  private createMappingToken(context: TemplateContext): MappingToken {
    const result = new MappingToken(this.file, this.line, this.col)
    context.memory.addToken(result, false)
    return result
  }

  private static convertToFormatArg(node: AbstractExpressionNode): string {
    let nodeString = node.convertToExpression()

    // If the node is a container, see if it starts with '(' and ends with ')' so we can simplify the string
    // Should only simplify if only one '(' or ')' exists in the string
    // We are trying to simplify the case (a || b) to a || b
    // But we should avoid simplifying ( a && b
    if (
      node.nodeType === NodeType.Container &&
      nodeString.length > 2 &&
      nodeString[0] === START_PARAMETER &&
      nodeString[nodeString.length - 1] === END_PARAMETER &&
      nodeString.lastIndexOf(START_PARAMETER) === 0 &&
      nodeString.indexOf(END_PARAMETER) === nodeString.length - 1
    ) {
      nodeString = nodeString.substr(1, nodeString.length - 2)
    }

    return `${OPEN_EXPRESSION} ${nodeString} ${CLOSE_EXPRESSION}`
  }
}

export class InsertExpressionToken extends ExpressionToken {
  public constructor(
    file: number | undefined,
    line: number | undefined,
    col: number | undefined
  ) {
    super(INSERT_EXPRESSION_TYPE, file, line, col, INSERT_DIRECTIVE)
  }

  public override clone(omitSource?: boolean): TemplateToken {
    return omitSource
      ? new InsertExpressionToken(undefined, undefined, undefined)
      : new InsertExpressionToken(this.file, this.line, this.col)
  }

  public override toString(): string {
    return `${OPEN_EXPRESSION} ${INSERT_DIRECTIVE} ${CLOSE_EXPRESSION}`
  }

  public override toDisplayString(): string {
    return ScalarToken.trimDisplayString(this.toString())
  }
}

export class EvaluateTokenResult {
  public value: TemplateToken
  public bytes: number

  public constructor(value: TemplateToken, bytes: number) {
    this.value = value
    this.bytes = bytes
  }
}

export class KeyValuePair {
  public readonly key: ScalarToken
  public readonly value: TemplateToken
  public constructor(key: ScalarToken, value: TemplateToken) {
    this.key = key
    this.value = value
  }
}

class StringKeyValuePair {
  public readonly key: string
  public readonly value: TemplateToken
  public constructor(key: string, value: TemplateToken) {
    this.key = key
    this.value = value
  }
}

class DummyFunction extends FunctionNode {
  public override evaluateCore(context: EvaluationContext): CoreResult {
    return <CoreResult>{
      value: undefined,
      memory: undefined,
    }
  }
}

class TraversalState {
  private readonly _token: TemplateToken
  private index = -1
  private isKey = false
  public readonly parent: TraversalState | undefined
  public current: TemplateToken | undefined

  public constructor(parent: TraversalState | undefined, token: TemplateToken) {
    this.parent = parent
    this._token = token
  }

  public moveNext(omitKeys: boolean): boolean {
    switch (this._token.templateTokenType) {
      case SEQUENCE_TYPE: {
        const sequence = this._token as SequenceToken
        if (++this.index < sequence.count) {
          this.current = sequence.get(this.index)
          return true
        }
        this.current = undefined
        return false
      }

      case MAPPING_TYPE: {
        const mapping = this._token as MappingToken

        // Already returned the key, now return the value
        if (this.isKey) {
          this.isKey = false
          this.current = mapping.get(this.index).value
          return true
        }

        // Move next
        if (++this.index < mapping.count) {
          // Skip the key, return the value
          if (omitKeys) {
            this.isKey = false
            this.current = mapping.get(this.index).value
            return true
          }

          // Return the key
          this.isKey = true
          this.current = mapping.get(this.index).key
          return true
        }

        this.current = undefined
        return false
      }

      default:
        throw new Error(
          `Unexpected token type '${this._token.templateTokenType}' when traversing state`
        )
    }
  }
}
