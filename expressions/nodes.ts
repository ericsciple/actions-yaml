import { NoOperationTraceWriter, TraceWriter } from "./trace-writer"
import * as expressionUtility from "./expression-utility"
import { FALSE, TRUE, WILDCARD } from "./expression-constants"
import { ExpressionNode } from "./parser"
import {
  ARRAY_TYPE,
  BOOLEAN_TYPE,
  CASE_SENSITIVE_DICTIONARY_TYPE,
  ContextData,
  DICTIONARY_TYPE,
  NUMBER_TYPE,
  StringContextData,
  STRING_TYPE,
} from "./context-data"

////////////////////////////////////////////////////////////////////////////////
// Expression node classes
////////////////////////////////////////////////////////////////////////////////

export enum NodeType {
  Literal,
  Wildcard,
  Container,
  NamedContext,
}

export abstract class AbstractExpressionNode implements ExpressionNode {
  /** Used for tracing. Indicates the nest-level */
  private _level = 0

  /** Used for tracing. Indicates the name of a non-literal node */
  public name = ""

  /** The parent node */
  public parent: ContainerNode | undefined

  /**
   * Used for tracing. Indicates whether the evaluation result should be stored on the context
   * and used when the realized result is traced. Typically this is false for operators/functions
   * that produce a boolean result, and true for everything else.
   */
  protected abstract get traceFullyRealized(): boolean

  public abstract get nodeType(): NodeType

  /**
   * Entry point when evaluating an expression tree
   */
  public evaluateTree(
    trace?: TraceWriter,
    state?: any,
    options?: EvaluationOptions
  ): EvaluationResult {
    // SDK consumer error
    if (this.parent) {
      throw new Error(
        `Expected IExpressionNode.Evaluate to be called on a root node only`
      )
    }

    // Evaluate
    trace = trace ?? new NoOperationTraceWriter()
    const context = new EvaluationContext(trace, state, options, this)
    trace.info(`Evaluating: ${this.convertToExpression()}`)
    const result = this.evaluate(context)

    // Trace the result
    this.traceTreeResult(context, result.value, result.kind)

    return result
  }

  /**
   * This function is intended only for ExpressionNode authors to call when evaluating a child node.
   * The EvaluationContext caches result-state specific to the evaluation of the entire expression tree.
   * */
  public evaluate(context: EvaluationContext): EvaluationResult {
    // Evaluate
    this._level = !this.parent ? 0 : this.parent._level + 1
    context.trace.verbose(
      `${expressionUtility.indent(this._level, "..")}Evaluating ${this.name}`
    )
    const coreResult = this.evaluateCore(context)

    if (!coreResult.memory) {
      coreResult.memory = new ResultMemory()
    }

    // Convert to canonical value
    const canonicalResult = new CanonicalValue(coreResult.value)

    // The depth can be safely trimmed when the total size of the core result is known,
    // or when the total size of the core result can easily be determined.
    const trimDepth =
      coreResult.memory.isTotal ||
      (!canonicalResult.raw &&
        expressionUtility.testPrimitive(canonicalResult.kind))

    // Account for the memory overhead of the core result
    let coreBytes: number
    if (typeof coreResult.memory.bytes === "number") {
      coreBytes = coreResult.memory.bytes
    } else {
      const objectToCalculate = canonicalResult.raw ?? canonicalResult.value
      coreBytes =
        typeof objectToCalculate === "string"
          ? MemoryCounter.calculateStringBytes(objectToCalculate as string)
          : MemoryCounter.MIN_OBJECT_SIZE // Add something
    }
    context.memory.addAmount(this._level, coreBytes, trimDepth)

    // Account for the memory overhead of the conversion result
    if (canonicalResult.raw) {
      const conversionBytes =
        typeof canonicalResult.value === "string"
          ? MemoryCounter.calculateStringBytes(canonicalResult.value)
          : MemoryCounter.MIN_OBJECT_SIZE
      context.memory.addAmount(this._level, conversionBytes)
    }

    const result = new EvaluationResult(canonicalResult, this._level)
    const message = `${expressionUtility.indent(
      this._level,
      ".."
    )}=> ${expressionUtility.formatValue(
      canonicalResult.value,
      canonicalResult.kind
    )}`
    context.trace.verbose(message)

    // Store the trace result
    if (this.traceFullyRealized) {
      context.setTraceResult(this, result)
    }

    return result
  }

  /** Used internally for tracing only */
  public abstract convertToExpression(): string

  /** Used internally for tracing only */
  public abstract convertToRealizedExpression(
    context: EvaluationContext
  ): string

  /** Evalutes the node */
  protected abstract evaluateCore(context: EvaluationContext): CoreResult

  protected createMemoryCounter(context: EvaluationContext): MemoryCounter {
    return new MemoryCounter(this, context.options.maxMemory)
  }

  private traceTreeResult(
    context: EvaluationContext,
    result: any,
    kind: ValueKind
  ): void {
    // Get the realized expression
    const realizedExpression = this.convertToRealizedExpression(context)

    // Format the result
    const traceValue = expressionUtility.formatValue(result, kind)

    // Only trace the realized expression when meaningfully different
    if (realizedExpression !== traceValue) {
      if (
        kind === ValueKind.Number &&
        realizedExpression === `'${traceValue}'`
      ) {
        // Intentionally empty. Don't bother tracing the realized expression when the result is a
        // number and the realized expression is a precisely matching string.
      } else {
        context.trace.info(`Expanded: ${realizedExpression}`)
      }
    }

    // Always trace the result
    context.trace.info(`Result: ${traceValue}`)
  }
}

export class LiteralNode extends AbstractExpressionNode {
  public readonly value: any
  public readonly kind: ValueKind

  public constructor(val: any) {
    super()
    const canonicalValue = new CanonicalValue(val)
    this.name = ValueKind[canonicalValue.kind]
    this.value = canonicalValue.value
    this.kind = canonicalValue.kind
  }

  protected override get traceFullyRealized(): boolean {
    return false
  }

  public override convertToExpression(): string {
    return expressionUtility.formatValue(this.value, this.kind)
  }

  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    return expressionUtility.formatValue(this.value, this.kind)
  }

  public override get nodeType(): NodeType {
    return NodeType.Literal
  }

  /** Evalutes the node */
  public override evaluateCore(context: EvaluationContext): CoreResult {
    return <CoreResult>{
      value: this.value,
      memory: undefined,
    }
  }
}

export class WildcardNode extends AbstractExpressionNode {
  // Prevent the value from being stored on the evaluation context.
  // This avoids unneccessarily duplicating the value in memory.
  protected override get traceFullyRealized(): boolean {
    return false
  }

  public override get nodeType(): NodeType {
    return NodeType.Wildcard
  }

  public override convertToExpression(): string {
    return WILDCARD
  }

  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    return WILDCARD
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    return <CoreResult>{
      value: WILDCARD,
      memory: undefined,
    }
  }
}

export abstract class NamedContextNode extends AbstractExpressionNode {
  protected override get traceFullyRealized(): boolean {
    return true
  }

  public override get nodeType(): NodeType {
    return NodeType.NamedContext
  }

  public override convertToExpression(): string {
    return this.name
  }

  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    // Check if the result was stored
    const result = context.getTraceResult(this)
    if (result) {
      return result
    }

    return this.name
  }
}

export class SimpleNamedContextNode extends NamedContextNode {
  private readonly _value: any

  public constructor(value: any) {
    super()
    this._value = value
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    return <CoreResult>{
      value: this._value,
      memory: undefined,
    }
  }
}

export abstract class ContainerNode extends AbstractExpressionNode {
  private readonly _parameters: AbstractExpressionNode[] = []

  public override get nodeType(): NodeType {
    return NodeType.Container
  }

  public get parameters(): ReadonlyArray<AbstractExpressionNode> {
    return this._parameters
  }

  public addParameter(node: AbstractExpressionNode): void {
    this._parameters.push(node)
    node.parent = this
  }
}

export abstract class FunctionNode extends ContainerNode {
  /**
   * Generally this should not be overridden. True indicates the result of the node is traced as part of the "expanded"
   * (i.e. "realized") trace information. Otherwise the node expression is printed, and parameters to the node may or
   * may not be fully realized - depending on each respective parameter's trace-fully-realized setting.
   *
   * The purpose is so the end user can understand how their expression expanded at run time. For example, consider
   * the expression: eq(variables.publish, 'true'). The runtime-expanded expression may be: eq('true', 'true')
   */
  protected override get traceFullyRealized(): boolean {
    return true
  }

  /** Do not override. Used internally for tracing only. */
  public override convertToExpression(): string {
    return `${this.name}(${this.parameters
      .map((x) => x.convertToExpression())
      .join(", ")})`
  }

  /** Do not override. Used internally for tracing only. */
  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    // Check if the result was stored
    const result = context.getTraceResult(this)
    if (result) {
      return result
    }

    return `${this.name}(${this.parameters.map((x) =>
      x.convertToRealizedExpression(context)
    )})`
  }
}

////////////////////////////////////////////////////////////////////////////////
// Evaluation classes
////////////////////////////////////////////////////////////////////////////////

export class EvaluationOptions {
  public maxMemory: number

  constructor(copy?: EvaluationOptions) {
    if (copy) {
      this.maxMemory = copy.maxMemory
    } else {
      this.maxMemory = 0
    }
  }
}

export interface CoreResult {
  value: any
  memory: ResultMemory | undefined
}

/**
 * Contains the result of the evaluation of a node. The value is canonicalized.
 * This class contains helper methods for comparison, coercion, etc.
 */
export class EvaluationResult {
  private _level: number
  public readonly value: any
  public readonly kind: ValueKind

  /** When an interface converter is applied to the node result, raw contains the original value */
  public readonly raw: any

  public constructor(value: CanonicalValue, level?: number) {
    this._level = level ?? 0
    this.value = value.value
    this.kind = value.kind
    this.raw = value.raw
  }

  public get isFalsy(): boolean {
    switch (this.kind) {
      case ValueKind.Null:
        return true
      case ValueKind.Boolean: {
        const b = this.value as boolean
        return b
      }
      case ValueKind.Number: {
        const n = this.value as number
        return n == 0 || isNaN(n)
      }
      case ValueKind.String: {
        const s = this.value as string
        return s === ""
      }
      default:
        return false
    }
  }

  public get isTruthy(): boolean {
    return !this.isFalsy
  }

  public get isPrimitive(): boolean {
    return expressionUtility.testPrimitive(this.kind)
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  public abstractEqual(right: EvaluationResult): boolean {
    return EvaluationResult.abstractEqual(
      this.value,
      right.value,
      this.kind,
      right.kind
    )
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  public abstractGreaterThan(right: EvaluationResult): boolean {
    return EvaluationResult.abstractGreaterThan(
      this.value,
      right.value,
      this.kind,
      right.kind
    )
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  public abstractGreaterThanOrEqual(right: EvaluationResult): boolean {
    return (
      EvaluationResult.abstractEqual(
        this.value,
        right.value,
        this.kind,
        right.kind
      ) ||
      EvaluationResult.abstractGreaterThan(
        this.value,
        right.value,
        this.kind,
        right.kind
      )
    )
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  public abstractLessThan(right: EvaluationResult): boolean {
    return EvaluationResult.abstractLessThan(
      this.value,
      right.value,
      this.kind,
      right.kind
    )
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  public abstractLessThanOrEqual(right: EvaluationResult): boolean {
    return (
      EvaluationResult.abstractEqual(
        this.value,
        right.value,
        this.kind,
        right.kind
      ) ||
      EvaluationResult.abstractLessThan(
        this.value,
        right.value,
        this.kind,
        right.kind
      )
    )
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  public abstractNotEqual(right: EvaluationResult): boolean {
    return !EvaluationResult.abstractEqual(
      this.value,
      right.value,
      this.kind,
      right.kind
    )
  }

  public convertToNumber(): number {
    return EvaluationResult.convertToNumber(this.value, this.kind)
  }

  public convertToString(): string {
    switch (this.kind) {
      case ValueKind.Null:
        return ""

      case ValueKind.Boolean:
        return this.value ? TRUE : FALSE

      case ValueKind.Number:
        // The value -0 should convert to '0'
        if (Object.is(this.value, -0)) {
          return "0"
        }
        return this.value.toString()

      case ValueKind.String:
        return this.value

      default:
        return ValueKind[this.kind]
    }
  }

  public getCollectionInterface():
    | ReadOnlyObjectCompatible
    | ReadOnlyArrayCompatible
    | undefined {
    if (this.kind === ValueKind.Object || this.kind === ValueKind.Array) {
      switch (this.value[COMPATIBLE_VALUE_KIND] ?? -1) {
        case ValueKind.Array:
          return this.value as ReadOnlyArrayCompatible
        case ValueKind.Object:
          return this.value as ReadOnlyObjectCompatible
      }
    }

    return
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  private static abstractEqual(
    canonicalLeftValue: any,
    canonicalRightValue: any,
    leftKind: ValueKind,
    rightKind: ValueKind
  ): boolean {
    const coercionResult = EvaluationResult.coerceTypes(
      canonicalLeftValue,
      canonicalRightValue,
      leftKind,
      rightKind
    )
    canonicalLeftValue = coercionResult.canonicalLeftValue
    canonicalRightValue = coercionResult.canonicalRightValue
    leftKind = coercionResult.leftKind
    rightKind = coercionResult.rightKind

    // Same kind
    if (leftKind === rightKind) {
      switch (leftKind) {
        // Null
        case ValueKind.Null:
          return true

        // Number
        case ValueKind.Number:
          if (isNaN(canonicalLeftValue) || isNaN(canonicalRightValue)) {
            return false
          }
          return canonicalLeftValue === canonicalRightValue

        // String
        case ValueKind.String:
          return (
            (canonicalLeftValue as string).toUpperCase() ==
            (canonicalRightValue as string).toUpperCase()
          )

        // Boolean
        case ValueKind.Boolean:
          return canonicalLeftValue === canonicalRightValue

        // Object
        // Array
        case ValueKind.Object:
        case ValueKind.Array:
          return canonicalLeftValue === canonicalRightValue // Same reference?
      }
    }

    return false
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  private static abstractGreaterThan(
    canonicalLeftValue: any,
    canonicalRightValue: any,
    leftKind: ValueKind,
    rightKind: ValueKind
  ): boolean {
    const coercionResult = EvaluationResult.coerceTypes(
      canonicalLeftValue,
      canonicalRightValue,
      leftKind,
      rightKind
    )
    canonicalLeftValue = coercionResult.canonicalLeftValue
    canonicalRightValue = coercionResult.canonicalRightValue
    leftKind = coercionResult.leftKind
    rightKind = coercionResult.rightKind

    // Same kind
    if (leftKind === rightKind) {
      switch (leftKind) {
        // Nummber
        case ValueKind.Number:
          if (isNaN(canonicalLeftValue) || isNaN(canonicalRightValue)) {
            return false
          }
          return canonicalLeftValue > canonicalRightValue

        // String
        case ValueKind.String:
          return (
            (canonicalLeftValue as string).toUpperCase() >
            (canonicalRightValue as string).toUpperCase()
          )

        // Boolean
        case ValueKind.Boolean:
          return canonicalLeftValue && !canonicalRightValue
      }
    }

    return false
  }

  /**
   * Similar to the Javascript abstract equality comparison algorithm http://www.ecma-international.org/ecma-262/5.1/#sec-11.9.3.
   * Except string comparison is ignore-case, and objects are not coerced to primitives.
   */
  private static abstractLessThan(
    canonicalLeftValue: any,
    canonicalRightValue: any,
    leftKind: ValueKind,
    rightKind: ValueKind
  ): boolean {
    const coercionResult = EvaluationResult.coerceTypes(
      canonicalLeftValue,
      canonicalRightValue,
      leftKind,
      rightKind
    )
    canonicalLeftValue = coercionResult.canonicalLeftValue
    canonicalRightValue = coercionResult.canonicalRightValue
    leftKind = coercionResult.leftKind
    rightKind = coercionResult.rightKind

    // Same kind
    if (leftKind === rightKind) {
      switch (leftKind) {
        // Nummber
        case ValueKind.Number:
          if (isNaN(canonicalLeftValue) || isNaN(canonicalRightValue)) {
            return false
          }
          return canonicalLeftValue < canonicalRightValue

        // String
        case ValueKind.String:
          return (
            (canonicalLeftValue as string).toUpperCase() <
            (canonicalRightValue as string).toUpperCase()
          )

        // Boolean
        case ValueKind.Boolean:
          return !canonicalLeftValue && canonicalRightValue
      }
    }

    return false
  }

  private static coerceTypes(
    canonicalLeftValue: any,
    canonicalRightValue: any,
    leftKind: ValueKind,
    rightKind: ValueKind
  ): CoercionResult {
    // Same kind
    if (leftKind === rightKind) {
      // Intentionally empty
    }
    // Number, String
    else if (leftKind === ValueKind.Number && rightKind === ValueKind.String) {
      canonicalRightValue = EvaluationResult.convertToNumber(
        canonicalRightValue,
        rightKind
      )
      rightKind = ValueKind.Number
    }
    // String, Number
    else if (leftKind === ValueKind.String && rightKind === ValueKind.Number) {
      canonicalLeftValue = EvaluationResult.convertToNumber(
        canonicalLeftValue,
        leftKind
      )
      leftKind = ValueKind.Number
    }
    // Boolean|Null, Any
    else if (leftKind === ValueKind.Boolean || leftKind === ValueKind.Null) {
      canonicalLeftValue = EvaluationResult.convertToNumber(
        canonicalLeftValue,
        leftKind
      )
      leftKind = ValueKind.Number
      return EvaluationResult.coerceTypes(
        canonicalLeftValue,
        canonicalRightValue,
        leftKind,
        rightKind
      )
    }
    // Any, Boolean|Null
    else if (rightKind === ValueKind.Boolean || rightKind === ValueKind.Null) {
      canonicalRightValue = EvaluationResult.convertToNumber(
        canonicalRightValue,
        rightKind
      )
      rightKind = ValueKind.Number
      return EvaluationResult.coerceTypes(
        canonicalLeftValue,
        canonicalRightValue,
        leftKind,
        rightKind
      )
    }

    return <CoercionResult>{
      canonicalLeftValue,
      canonicalRightValue,
      leftKind,
      rightKind,
    }
  }

  /**
   * For primitives, follows the Javascript rules (the Number function in Javascript). Otherwise NaN.
   */
  private static convertToNumber(canonicalValue: any, kind: ValueKind): number {
    switch (kind) {
      case ValueKind.Null:
        return 0
      case ValueKind.Boolean:
        return canonicalValue === true ? 1 : 0
      case ValueKind.Number:
        return canonicalValue
      case ValueKind.String:
        return expressionUtility.parseNumber(canonicalValue)
    }

    return NaN
  }
}

/**
 * Used internally by EvaluationResult
 */
interface CoercionResult {
  canonicalLeftValue: any
  canonicalRightValue: any
  leftKind: ValueKind
  rightKind: ValueKind
}

/**
 * Stores context related to the evaluation of an expression tree
 */
export class EvaluationContext {
  private readonly _traceResults = new Map<AbstractExpressionNode, string>()
  private readonly _traceMemory: MemoryCounter
  public readonly trace: TraceWriter
  public readonly state: any
  public readonly options: EvaluationOptions
  public readonly memory: EvaluationMemory

  public constructor(
    trace: TraceWriter,
    state: any,
    options: EvaluationOptions | undefined,
    node: AbstractExpressionNode
  ) {
    this.trace = trace
    this.state = state

    // Copy the options
    options = new EvaluationOptions(options)
    if (options.maxMemory === 0) {
      // Set a reasonable default max memory
      options.maxMemory = 1048576 // 1mb
    }

    this.options = options
    this.memory = new EvaluationMemory(options.maxMemory, node)
    this._traceMemory = new MemoryCounter(undefined, options.maxMemory)
  }

  public setTraceResult(
    node: AbstractExpressionNode,
    result: EvaluationResult
  ): void {
    // Remove if previously added. This typically should not happen. This could happen
    // due to a badly authored function. So we'll handle it and track memory correctly.
    const previousResult = this._traceResults.get(node)
    if (previousResult) {
      this._traceMemory.subtractString(previousResult)
      this._traceResults.delete(node)
    }

    // Check max memory

    const value = expressionUtility.formatValue(result.value, result.kind)
    if (this._traceMemory.tryAddString(value)) {
      // Store the result
      this._traceResults.set(node, value)
    }
  }

  public getTraceResult(node: AbstractExpressionNode): string | undefined {
    return this._traceResults.get(node)
  }
}

////////////////////////////////////////////////////////////////////////////////
// Value types, canonicalization, and interfaces for type compatibility
////////////////////////////////////////////////////////////////////////////////

export enum ValueKind {
  Array,
  Boolean,
  Null,
  Number,
  Object,
  String,
}

export class CanonicalValue {
  public readonly value: any
  public readonly kind: ValueKind
  public readonly raw: any

  public constructor(value: any) {
    switch (typeof value) {
      case "undefined":
        this.value = null
        this.kind = ValueKind.Null
        return
      case "boolean":
        this.value = value
        this.kind = ValueKind.Boolean
        return
      case "number":
        this.value = value
        this.kind = ValueKind.Number
        return
      case "string":
        this.value = value
        this.kind = ValueKind.String
        return
    }

    if (value === null) {
      this.value = null
      this.kind = ValueKind.Null
      return
    }

    switch (value[COMPATIBLE_VALUE_KIND]) {
      case ValueKind.Null:
        this.value = null
        this.kind = ValueKind.Null
        return
      case ValueKind.Boolean: {
        const b = value as BooleanCompatible
        this.value = b.getBoolean()
        this.kind = ValueKind.Boolean
        return
      }
      case ValueKind.Number: {
        const n = value as NumberCompatible
        this.value = n.getNumber()
        this.kind = ValueKind.Number
        return
      }
      case ValueKind.String: {
        const s = value as StringCompatible
        this.value = s.getString()
        this.kind = ValueKind.String
        return
      }
      case ValueKind.Object:
        this.value = value
        this.kind = ValueKind.Object
        return
      case ValueKind.Array:
        this.value = value
        this.kind = ValueKind.Array
        return
    }

    this.value = value
    this.kind = ValueKind.Object
  }
}

const COMPATIBLE_VALUE_KIND = "compatibleValueKind"

export interface CompatibleValue {
  get compatibleValueKind(): ValueKind
}

export type NullCompatible = CompatibleValue

export interface BooleanCompatible extends CompatibleValue {
  getBoolean(): boolean
}

export interface NumberCompatible extends CompatibleValue {
  getNumber(): number
}

export interface StringCompatible extends CompatibleValue {
  getString(): string
}

export interface ReadOnlyArrayCompatible extends CompatibleValue {
  getArrayLength(): number
  getArrayItem(index: number): any
}

export interface ReadOnlyObjectCompatible extends CompatibleValue {
  hasObjectKey(key: string): boolean
  getObjectKeys(): string[]
  getObjectKeyCount(): number
  getObjectValue(key: string): any
}

////////////////////////////////////////////////////////////////////////////////
// Classes related to tracking memory utilization
////////////////////////////////////////////////////////////////////////////////

/**
 * Helper class for ExpressionNode authors. This class helps calculate memory overhead for a result object.
 */
export class MemoryCounter {
  public static readonly MIN_OBJECT_SIZE = 24
  private static readonly POINTER_SIZE = 8
  private static readonly STRING_BASE_OVERHEAD = 26
  private readonly _node: AbstractExpressionNode | undefined
  private _currentBytes = 0
  public readonly maxBytes: number

  public constructor(node?: AbstractExpressionNode, maxBytes?: number) {
    this._node = node
    this.maxBytes = (maxBytes ?? 0) > 0 ? maxBytes! : 2147483647 // max int32
  }

  public get currentBytes(): number {
    return this._currentBytes
  }

  public addAmount(bytes: number): void {
    if (!this.tryAddAmount(bytes)) {
      if (this._node) {
        throw new Error(
          `The maximum allowed memory size was exceeded while evaluating the following expression: ${this._node.convertToExpression()}`
        )
      }

      throw new Error("The maximum allowed memory size was exceeded")
    }
  }

  public addContextData(value: ContextData | null, traverse: boolean): void {
    this.addAmount(MemoryCounter.calculateContextDataBytes(value, traverse))
  }

  public addMinObjectSize(): void {
    this.addAmount(MemoryCounter.MIN_OBJECT_SIZE)
  }

  public addPointer(): void {
    this.addAmount(MemoryCounter.POINTER_SIZE)
  }

  public addString(value: string): void {
    this.addAmount(MemoryCounter.calculateStringBytes(value))
  }

  public subtractAmount(bytes: number): void {
    if (bytes > this._currentBytes) {
      throw new Error("Bytes to subtract exceeds total bytes")
    }
    this._currentBytes -= bytes
  }

  public subtractString(value: string): void {
    this.subtractAmount(MemoryCounter.calculateStringBytes(value))
  }

  public tryAddAmount(bytes: number): boolean {
    bytes += this._currentBytes

    if (bytes > this.maxBytes) {
      return false
    }

    this._currentBytes = bytes
    return true
  }

  public tryAddString(value: string): boolean {
    return this.tryAddAmount(MemoryCounter.calculateStringBytes(value))
  }

  public static calculateStringBytes(value: string): number {
    // This measurement doesn't have to be perfect.
    // https://codeblog.jonskeet.uk/2011/04/05/of-memory-and-strings/

    return MemoryCounter.STRING_BASE_OVERHEAD + value.length * 2
  }

  public static calculateContextDataBytes(
    value: ContextData | null,
    traverse: boolean
  ): number {
    let result = 0
    const values = traverse ? ContextData.traverse(value) : [value]
    for (const item of values) {
      // This measurement doesn't have to be perfect
      // https://codeblog.jonskeet.uk/2011/04/05/of-memory-and-strings/
      switch (item?.type) {
        case STRING_TYPE: {
          const str = (item as StringContextData).value
          result += this.MIN_OBJECT_SIZE + this.calculateStringBytes(str)
          break
        }
        case ARRAY_TYPE:
        case DICTIONARY_TYPE:
        case CASE_SENSITIVE_DICTIONARY_TYPE:
        case BOOLEAN_TYPE:
        case NUMBER_TYPE:
          // Min object size is good enough. Allows for base + a few fields.
          result += this.MIN_OBJECT_SIZE
          break
        case undefined:
          result += this.POINTER_SIZE
          break
        default:
          throw new Error(
            `Unexpected pipeline context data type '${item?.type}'`
          )
      }
    }

    return result
  }
}

export class ResultMemory {
  public constructor(
    bytes: number | undefined = undefined,
    isTotal: boolean | undefined = undefined
  ) {
    if (bytes !== undefined) {
      this.bytes = bytes
    }

    if (isTotal !== undefined) {
      this.isTotal = isTotal
    }
  }
  /**
   * Only set a non-null value when both of the following conditions are met:
   * 1) The result is a complex object. In other words, the result is
   * not a simple type: string, boolean, number, or null.
   * 2) The result is a newly created object.
   *
   * For example, consider a function fromJson() which takes a string parameter,
   * and returns an object. The object is newly created and a rough
   * measurement should be returned for the number of bytes it consumes in memory.
   *
   * For another example, consider a function which returns a sub-object from a
   * complex parameter value. From the perspective of an individual function,
   * the size of the complex parameter value is unknown. In this situation, set the
   * value to IntPtr.Size.
   *
   * When you are unsure, set the value to null. Null indicates the overhead of a
   * new pointer should be accounted for.
   */
  public bytes: number | undefined

  /**
   * Indicates whether Bytes represents the total size of the result.
   * True indicates the accounting-overhead of downstream parameters can be discarded.
   *
   * For example, consider a function fromJson() which takes a string paramter,
   * and returns an object. The object is newly created and a rough
   * measurement should be returned for the amount of bytes it consumes in memory.
   * Set isTotal to true, since new object contains no references
   * to previously allocated memory.
   *
   * For another example, consider a function which wraps a complex parameter result.
   * The field bytes should be set to the amount of newly allocated memory.
   * However since the object references previously allocated memory, set isTotal
   * to false.
   */
  public isTotal = false
}

/**
 * This is an internal class.
 *
 * This class is used to track current memory consumption
 * across the entire expression evaluation.
 */
class EvaluationMemory {
  private readonly _maxBytes: number
  private readonly _node: AbstractExpressionNode
  private readonly _depths: number[] = []
  private _maxActiveDepth = -1
  private _totalBytes = 0

  public constructor(maxBytes: number, node: AbstractExpressionNode) {
    this._maxBytes = maxBytes
    this._node = node
  }

  public addAmount(depth: number, bytes: number, trimDepth?: boolean): void {
    // Trim depth
    if (trimDepth) {
      while (this._maxActiveDepth > depth) {
        const bytes = this._depths[this._maxActiveDepth]
        if (bytes > 0) {
          // Coherency check
          if (bytes > this._totalBytes) {
            throw new Error("Bytes to subtract exceeds total bytes")
          }

          // Subtract from the total
          this._totalBytes -= bytes

          // Reset the bytes
          this._depths[this._maxActiveDepth] = 0
        }

        this._maxActiveDepth--
      }
    }

    // Grow the depths
    if (depth > this._maxActiveDepth) {
      // Grow the array
      while (this._depths.length <= depth) {
        this._depths.push(0)
      }

      // Adjust the max active depth
      this._maxActiveDepth = depth
    }

    // Add to the depth
    this._depths[depth] += bytes

    // Add to the total
    this._totalBytes += bytes

    // Check max
    if (this._totalBytes > this._maxBytes) {
      throw new Error(
        `The maximum allowed memory size was exceeded while evaluating the following expression: ${this._node.convertToExpression()}`
      )
    }
  }
}
