import { NoOperationTraceWriter, TraceWriter } from "./trace-writer"
import {
  ContainerNode,
  AbstractExpressionNode,
  FunctionNode,
  NamedContextNode,
  NodeType,
  EvaluationResult,
  EvaluationOptions,
  CoreResult,
  EvaluationContext,
} from "./nodes"
import {
  Associativity,
  LexicalAnalyzer,
  Token,
  TokenKind,
} from "./lexical-analyzer"
import { And } from "./operators/and"
import { Or } from "./operators/or"
import { MAX_DEPTH, MAX_LENGTH } from "./expression-constants"
import { Contains } from "./functions/contains"
import { EndsWith } from "./functions/ends-with"
import { Format } from "./functions/format"
import { Join } from "./functions/join"
import { StartsWith } from "./functions/starts-with"
import { ToJson } from "./functions/to-json"
import { FromJson } from "./functions/from-json"

const WELL_KNOWN_FUNCTIONS: { [name: string]: FunctionInfo } = {}
function addFunction(
  name: string,
  minParameters: number,
  maxParameters: number,
  createNode: () => FunctionNode
): void {
  WELL_KNOWN_FUNCTIONS[name.toUpperCase()] = <FunctionInfo>{
    name,
    minParameters,
    maxParameters,
    createNode,
  }
}
addFunction("contains", 2, 2, () => new Contains())
addFunction("endsWith", 2, 2, () => new EndsWith())
addFunction("format", 1, 255, () => new Format())
addFunction("join", 1, 2, () => new Join())
addFunction("startsWith", 2, 2, () => new StartsWith())
addFunction("toJson", 1, 1, () => new ToJson())
addFunction("fromJson", 1, 1, () => new FromJson())

export interface FunctionInfo {
  name: string
  minParameters: number
  maxParameters: number
  createNode(): FunctionNode
}

export interface NamedContextInfo {
  name: string
  createNode(): NamedContextNode
}

export interface ExpressionNode {
  /**
   * Entry point when evaluating an expression tree
   */
  evaluateTree(
    trace: TraceWriter,
    state?: any,
    options?: EvaluationOptions
  ): EvaluationResult
}

export function createExpressionTree(
  expression: string,
  trace?: TraceWriter,
  namedContexts?: NamedContextInfo[],
  functions?: FunctionInfo[]
): ExpressionNode | undefined {
  const context = new ParseContext(expression, trace, namedContexts, functions)
  context.trace.info(`Parsing expression: <${expression}>`)
  return createTreeInternal(context)
}

export function validateExpressionSyntax(
  expression: string,
  trace?: TraceWriter
): ExpressionNode | undefined {
  const context = new ParseContext(
    expression,
    trace,
    undefined,
    undefined,
    true
  )
  context.trace.info(`Validating expression syntax: <${expression}>`)
  return createTreeInternal(context)
}

function createTreeInternal(context: ParseContext) {
  // Push the tokens
  for (;;) {
    context.token = context.lexicalAnalyzer.getNextToken()

    // No more tokens
    if (!context.token) {
      break
    }
    // Unexpected
    else if (context.token.kind === TokenKind.Unexpected) {
      throw createParseError(
        ParseErrorKind.UnexpectedSymbol,
        context.token,
        context.expression
      )
    }
    // Operator
    else if (context.token.isOperator) {
      pushOperator(context)
    }
    // Operand
    else {
      pushOperand(context)
    }

    context.lastToken = context.token
  }

  // No tokens
  if (!context.lastToken) {
    return undefined
  }

  // Check unexpected end of expression
  if (context.operators.length > 0) {
    let unexpectedLastToken = false
    switch (context.lastToken.kind) {
      case TokenKind.EndGroup: // ")" logical grouping
      case TokenKind.EndIndex: // "]"
      case TokenKind.EndParameters: // ")" function call
        // Legal
        break
      case TokenKind.Function:
        // Illegal
        unexpectedLastToken = true
        break
      default:
        unexpectedLastToken = context.lastToken.isOperator
        break
    }

    if (unexpectedLastToken || context.lexicalAnalyzer.hasUnclosedTokens) {
      throw createParseError(
        ParseErrorKind.UnexpectedEndOfExpression,
        context.lastToken,
        context.expression
      )
    }
  }

  // Flush operators
  while (context.operators.length > 0) {
    flushTopOperator(context)
  }

  // Coherency check - verify exactly one operand
  if (context.operands.length !== 1) {
    throw new Error("Expected exactly one operand")
  }

  // Check max depth
  const result = context.operands[0]
  checkMaxDepth(context, result)
  return result
}

function pushOperand(context: ParseContext): void {
  // Create the node
  let node: AbstractExpressionNode
  switch (context.token!.kind) {
    // Function
    case TokenKind.Function: {
      const name = context.token!.rawValue
      const functionInfo = getFunctionInfo(context, name)
      if (functionInfo) {
        node = functionInfo.createNode()
        node.name = name
      } else if (context.allowUnknownKeywords) {
        node = new NoOperationFunction()
        node.name = name
      } else {
        throw createParseError(
          ParseErrorKind.UnrecognizedFunction,
          context.token,
          context.expression
        )
      }
      break
    }

    // Named-context
    case TokenKind.NamedContext: {
      const name = context.token!.rawValue
      const namedContextInfo =
        context.extensionNamedContexts[name.toUpperCase()]
      if (namedContextInfo) {
        node = namedContextInfo.createNode()
        node.name = name
      } else if (context.allowUnknownKeywords) {
        node = new NoOperationNamedContext()
        node.name = name
      } else {
        throw createParseError(
          ParseErrorKind.UnrecognizedNamedContext,
          context.token,
          context.expression
        )
      }
      break
    }

    // Otherwise simple
    default:
      node = context.token!.toNode()
      break
  }

  // Push the operand
  context.operands.push(node)
}

function pushOperator(context: ParseContext): void {
  // Flush higher or equal precedence
  if (context.token!.associativity === Associativity.LeftToRight) {
    const precedence = context.token!.precedence
    while (context.operators.length > 0) {
      const topOperator = context.operators[context.operators.length - 1]
      if (
        precedence <= topOperator.precedence &&
        topOperator.kind !== TokenKind.StartGroup && // Unless top is "(" logical grouping
        topOperator.kind !== TokenKind.StartIndex && // or unless top is "["
        topOperator.kind !== TokenKind.StartParameters && // or unless top is "("
        topOperator.kind !== TokenKind.Separator
      ) {
        // or unless top is ","

        flushTopOperator(context)
        continue
      }

      break
    }
  }

  // Push the operator
  context.operators.push(context.token!)

  // Process closing operators now, since context.lastToken is required
  // to accurately process TokenKind.EndParameters
  switch (context.token!.kind) {
    case TokenKind.EndGroup: // ")" logical grouping
    case TokenKind.EndIndex: // "]"
    case TokenKind.EndParameters: // ")" function call
      flushTopOperator(context)
      break
  }
}

function flushTopOperator(context: ParseContext): void {
  // Special handling for closing operators
  switch (context.operators[context.operators.length - 1].kind) {
    case TokenKind.EndIndex: // "]"
      flushTopEndIndex(context)
      return

    case TokenKind.EndGroup: // ")" logical grouping
      flushTopEndGroup(context)
      return

    case TokenKind.EndParameters: // ")" function call
      flushTopEndParameters(context)
      return
  }

  // Pop the operator
  const operator = context.operators.pop()!

  // Create the node
  const node = operator.toNode() as ContainerNode

  // Pop the operands, add to the node
  const operands = popOperands(context, operator.operandCount)
  for (const operand of operands) {
    // Flatten nested And
    if ((node as And | undefined)?.isAndOperator === true) {
      if ((operand as And | undefined)?.isAndOperator === true) {
        const nestedAnd = operand as And
        for (const nestedParameter of nestedAnd.parameters) {
          node.addParameter(nestedParameter)
        }

        continue
      }
    }
    // Flatten nested Or
    else if ((node as Or | undefined)?.isOrOperator === true) {
      if ((operand as Or | undefined)?.isOrOperator === true) {
        const nestedOr = operand as Or
        for (const nestedParameter of nestedOr.parameters) {
          node.addParameter(nestedParameter)
        }

        continue
      }
    }

    node.addParameter(operand)
  }

  // Push the node to thee operand stack
  context.operands.push(node)
}

/**
 * Flushes the ")" logical grouping operator
 */
function flushTopEndGroup(context: ParseContext): void {
  // Pop the operators
  popOperator(context, TokenKind.EndGroup) // ")" logical grouping
  popOperator(context, TokenKind.StartGroup) // "(" logical grouping
}

/**
 * Flushes the "]" operator
 */
function flushTopEndIndex(context: ParseContext): void {
  // Pop the operators
  popOperator(context, TokenKind.EndIndex) // "]"
  const operator = popOperator(context, TokenKind.StartIndex) // "["

  // Create the node
  const node = operator.toNode() as ContainerNode

  // Pop the operands, add to the node
  const operands = popOperands(context, operator.operandCount)
  for (const operand of operands) {
    node.addParameter(operand)
  }

  // Push the node to the operand stack
  context.operands.push(node)
}

/**
 * Flushes the ")" function call operator
 */
function flushTopEndParameters(context: ParseContext): void {
  // Pop the operator
  let operator = popOperator(context, TokenKind.EndParameters) // ")" function call

  // Coherency check - top operator is the current token
  if (operator !== context.token) {
    throw new Error("Expected the operator to be the current token")
  }

  let func: FunctionNode

  // No parameters
  if (context.lastToken!.kind === TokenKind.StartParameters) {
    // Node already exists on the operand stack
    func = context.operands[context.operands.length - 1] as FunctionNode
  }
  // Has parameters
  else {
    // Pop the operands
    let parameterCount = 1
    while (
      context.operators[context.operators.length - 1].kind ===
      TokenKind.Separator
    ) {
      parameterCount++
      context.operators.pop()
    }
    const functionOperands = popOperands(context, parameterCount)

    // Node already exists on the operand stack
    func = context.operands[context.operands.length - 1] as FunctionNode

    // Add the operands to the node
    for (const operand of functionOperands) {
      func.addParameter(operand)
    }
  }

  // Pop the "(" operator too
  operator = popOperator(context, TokenKind.StartParameters)

  // Check min/max parameter count
  const functionInfo = getFunctionInfo(context, func.name)
  if (!functionInfo && context.allowUnknownKeywords) {
    // Don't check min/max
  } else if (func.parameters.length < functionInfo!.minParameters) {
    throw createParseError(
      ParseErrorKind.TooFewParameters,
      operator,
      context.expression
    )
  } else if (func.parameters.length > functionInfo!.maxParameters) {
    throw createParseError(
      ParseErrorKind.TooManyParameters,
      operator,
      context.expression
    )
  }
}

/**
 * Pops N operands from the operand stack. The operands are returned
 * in their natural listed order, i.e. not last-in-first-out.
 */
function popOperands(
  context: ParseContext,
  count: number
): AbstractExpressionNode[] {
  const result: AbstractExpressionNode[] = []
  while (count-- > 0) {
    result.unshift(context.operands.pop()!)
  }

  return result
}

/**
 * Pops an operator and asserts it is the expected kind.
 */
function popOperator(context: ParseContext, expected: TokenKind): Token {
  const token = context.operators.pop()!
  if (token.kind !== expected) {
    throw new Error(
      `Expected operator '${expected}' to be popped. Actual '${token.kind}'`
    )
  }
  return token
}

/**
 * Checks the max depth of the expression tree
 */
function checkMaxDepth(
  context: ParseContext,
  node: AbstractExpressionNode,
  depth = 1
): void {
  if (depth > MAX_DEPTH) {
    throw createParseError(
      ParseErrorKind.ExceededMaxDepth,
      undefined,
      context.expression
    )
  }

  if (node.nodeType === NodeType.Container) {
    const container = node as ContainerNode
    for (const parameter of container.parameters) {
      checkMaxDepth(context, parameter, depth + 1)
    }
  }
}

function getFunctionInfo(
  context: ParseContext,
  name: string
): FunctionInfo | undefined {
  const upperName = name.toUpperCase()
  return (
    WELL_KNOWN_FUNCTIONS[upperName] ?? context.extensionFunctions[upperName]
  )
}

function createParseError(
  kind: ParseErrorKind,
  token: Token | undefined,
  expression: string
): Error {
  let description: string
  switch (kind) {
    case ParseErrorKind.ExceededMaxDepth:
      description = `Exceeded max expression depth ${MAX_DEPTH}`
      break
    case ParseErrorKind.ExceededMaxLength:
      description = `Exceeded max expression length ${MAX_LENGTH}`
      break
    case ParseErrorKind.TooFewParameters:
      description = "Too few parameters supplied"
      break
    case ParseErrorKind.TooManyParameters:
      description = "Too many parameters supplied"
      break
    case ParseErrorKind.UnexpectedEndOfExpression:
      description = "Unexpected end of expression"
      break
    case ParseErrorKind.UnexpectedSymbol:
      description = "Unexpected symbol"
      break
    case ParseErrorKind.UnrecognizedFunction:
      description = "Unrecognized function"
      break
    case ParseErrorKind.UnrecognizedNamedContext:
      description = "Unrecognized named-context"
      break
    default:
      // Should never reach here
      throw new Error(`Unexpected parse exception kind '${kind}'`)
  }

  if (!token) {
    return new Error(description)
  }

  return new Error(
    `${description}: '${token.rawValue}'. Located at position ${
      token.index + 1
    } within expression: ${expression}`
  )
}

class NoOperationNamedContext extends NamedContextNode {
  public override evaluateCore(context: EvaluationContext): CoreResult {
    return <CoreResult>{
      value: undefined,
      memory: undefined,
    }
  }
}

class NoOperationFunction extends FunctionNode {
  public override evaluateCore(context: EvaluationContext): CoreResult {
    return <CoreResult>{
      value: undefined,
      memory: undefined,
    }
  }
}

class ParseContext {
  public readonly allowUnknownKeywords: boolean
  public readonly expression: string
  public readonly extensionFunctions: { [name: string]: FunctionInfo } = {}
  public readonly extensionNamedContexts: { [name: string]: NamedContextInfo } =
    {}
  public readonly lexicalAnalyzer: LexicalAnalyzer
  public readonly operands: AbstractExpressionNode[] = []
  public readonly operators: Token[] = []
  public readonly trace: TraceWriter
  public token: Token | undefined
  public lastToken: Token | undefined

  public constructor(
    expression: string,
    trace?: TraceWriter,
    namedContexts?: NamedContextInfo[],
    functions?: FunctionInfo[],
    allowUnknownKeywords?: boolean
  ) {
    this.expression = expression
    if (this.expression.length > MAX_LENGTH) {
      throw createParseError(
        ParseErrorKind.ExceededMaxLength,
        undefined,
        expression
      )
    }

    this.trace = trace ?? new NoOperationTraceWriter()
    for (const namedContextInfo of namedContexts ?? []) {
      this.extensionNamedContexts[namedContextInfo.name.toUpperCase()] =
        namedContextInfo
    }

    for (const functionInfo of functions ?? []) {
      this.extensionFunctions[functionInfo.name.toUpperCase()] = functionInfo
    }

    this.lexicalAnalyzer = new LexicalAnalyzer(this.expression)
    this.allowUnknownKeywords = allowUnknownKeywords ?? false
  }
}

enum ParseErrorKind {
  ExceededMaxDepth,
  ExceededMaxLength,
  TooFewParameters,
  TooManyParameters,
  UnexpectedEndOfExpression,
  UnexpectedSymbol,
  UnrecognizedFunction,
  UnrecognizedNamedContext,
}
