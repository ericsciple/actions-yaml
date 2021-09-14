import * as expressionUtility from "./expression-utility"
import {
  AND,
  DEREFERENCE,
  END_GROUP,
  END_INDEX,
  EQUAL,
  FALSE,
  GREATER_THAN,
  GREATER_THAN_OR_EQUAL,
  INFINITY,
  LESS_THAN,
  LESS_THAN_OR_EQUAL,
  NAN,
  NOT,
  NOT_EQUAL,
  NULL,
  OR,
  SEPARATOR,
  START_GROUP,
  START_INDEX,
  TRUE,
  WILDCARD,
} from "./expression-constants"
import { AbstractExpressionNode, LiteralNode, WildcardNode } from "./nodes"
import { Or } from "./operators/or"
import { And } from "./operators/and"
import { Equal } from "./operators/equal"
import { LessThanOrEqual } from "./operators/less-than-or-equal"
import { LessThan } from "./operators/less-than"
import { GreaterThanOrEqual } from "./operators/greater-than-or-equal"
import { GreaterThan } from "./operators/greater-than"
import { NotEqual } from "./operators/not-equal"
import { Not } from "./operators/not"
import { Index } from "./operators"

export enum Associativity {
  None,
  LeftToRight,
  RightToLeft,
}

export enum TokenKind {
  // Punctuation
  StartGroup, // "(" logical grouping
  StartIndex, // "["
  StartParameters, // "(" function call
  EndGroup, // ")" logical grouping
  EndIndex, // "]"
  EndParameters, // ")" function call
  Separator, // ","
  Dereference, // "."
  Wildcard, // "*"
  LogicalOperator, // "!", "==", etc

  // Values
  Null,
  Boolean,
  Number,
  String,
  PropertyName,
  Function,
  NamedContext,

  Unexpected,
}

export class Token {
  public readonly kind: TokenKind
  public readonly rawValue: string
  public readonly index: number
  public readonly parsedValue: undefined | boolean | number | string

  public constructor(
    kind: TokenKind,
    rawValue: string,
    index: number,
    parsedValue?: boolean | number | string
  ) {
    this.kind = kind
    this.rawValue = rawValue
    this.index = index
    this.parsedValue = parsedValue
  }

  public get associativity(): Associativity {
    switch (this.kind) {
      case TokenKind.StartGroup:
        return Associativity.None
      case TokenKind.LogicalOperator:
        if (this.rawValue === NOT) {
          return Associativity.RightToLeft
        }
        break
    }

    return this.isOperator ? Associativity.LeftToRight : Associativity.None
  }

  public get isOperator(): boolean {
    switch (this.kind) {
      case TokenKind.StartGroup: // "(" logical grouping
      case TokenKind.StartIndex: // "["
      case TokenKind.StartParameters: // "(" function call
      case TokenKind.EndGroup: // ")" logical grouping
      case TokenKind.EndIndex: // "]"
      case TokenKind.EndParameters: // ")" function call
      case TokenKind.Separator: // ","
      case TokenKind.Dereference: // "."
      case TokenKind.LogicalOperator: // "!", "==", etc
        return true
      default:
        return false
    }
  }

  /**
   * Operator precedence. The value is only meaningful for operator tokens.
   */
  public get precedence(): number {
    switch (this.kind) {
      case TokenKind.StartGroup: // "(" logical grouping
        return 20
      case TokenKind.StartIndex: // "["
      case TokenKind.StartParameters: // "(" function call
      case TokenKind.Dereference: // "."
        return 19
      case TokenKind.LogicalOperator:
        switch (this.rawValue) {
          case NOT: // "!"
            return 16
          case GREATER_THAN: // ">"
          case GREATER_THAN_OR_EQUAL: // ">="
          case LESS_THAN: // "<"
          case LESS_THAN_OR_EQUAL: // "<="
            return 11
          case EQUAL: // "=="
          case NOT_EQUAL: // "!="
            return 10
          case AND: // "&&"
            return 6
          case OR: // "||"
            return 5
        }
        break
      case TokenKind.EndGroup: // ")" logical grouping
      case TokenKind.EndIndex: // "]"
      case TokenKind.EndParameters: // ")" function call
      case TokenKind.Separator: // ","
        return 1
    }

    return 0
  }

  /**
   * Expected number of operands. The value is only meaningful for standalone unary operators and binary operators.
   */
  public get operandCount(): number {
    switch (this.kind) {
      case TokenKind.StartIndex: // "["
      case TokenKind.Dereference: // "."
        return 2
      case TokenKind.LogicalOperator:
        switch (this.rawValue) {
          case NOT: // "!"
            return 1
          case GREATER_THAN: // ">"
          case GREATER_THAN_OR_EQUAL: // ">="
          case LESS_THAN: // "<"
          case LESS_THAN_OR_EQUAL: // "<="
          case EQUAL: // "=="
          case NOT_EQUAL: // "!="
          case AND: // "&&"
          case OR: // "|"
            return 2
        }
        break
    }

    return 0
  }

  public toNode(): AbstractExpressionNode {
    switch (this.kind) {
      case TokenKind.StartIndex: // "["
      case TokenKind.Dereference: // "."
        return new Index()

      case TokenKind.LogicalOperator:
        switch (this.rawValue) {
          case NOT: // "!"
            return new Not()

          case NOT_EQUAL: // "!="
            return new NotEqual()

          case GREATER_THAN: // ">"
            return new GreaterThan()

          case GREATER_THAN_OR_EQUAL: // ">="
            return new GreaterThanOrEqual()

          case LESS_THAN: // "<"
            return new LessThan()

          case LESS_THAN_OR_EQUAL: // "<="
            return new LessThanOrEqual()

          case EQUAL: // "=="
            return new Equal()

          case AND: // "&&"
            return new And()

          case OR: // "||"
            return new Or()

          default:
            throw new Error(
              `Unexpected logical operator '${this.rawValue}' when creating node`
            )
        }

      case TokenKind.Null:
      case TokenKind.Boolean:
      case TokenKind.Number:
      case TokenKind.String:
        return new LiteralNode(this.parsedValue)

      case TokenKind.PropertyName:
        return new LiteralNode(this.rawValue)

      case TokenKind.Wildcard: // "*"
        return new WildcardNode()
    }

    throw new Error(`Unexpected kind '${this.kind}' when creating node`)
  }
}

export class LexicalAnalyzer {
  /** Raw expression string */
  private readonly _expression: string

  /** Unclosed start token */
  private readonly _unclosedTokens: Token[] = []

  /** Index within raw expression string */
  private _index = 0

  /** Stores the last read token */
  private _lastToken: Token | undefined

  public constructor(expression: string) {
    this._expression = expression
  }

  private get _lastUnclosedToken(): Token | undefined {
    if (this._unclosedTokens.length == 0) {
      return undefined
    }

    return this._unclosedTokens[this._unclosedTokens.length - 1]
  }

  public get hasUnclosedTokens(): boolean {
    return this._unclosedTokens.length > 0
  }

  public getNextToken(): Token | undefined {
    // Skip whitespace
    while (
      this._index < this._expression.length &&
      /\s/.test(this._expression[this._index])
    ) {
      this._index++
    }

    // End of string
    if (this._index >= this._expression.length) {
      return undefined
    }

    let token: Token

    // Read the first character to determine the type of token
    const c = this._expression[this._index]
    switch (c) {
      case START_GROUP: // "("
        // Function call
        if (this._lastToken?.kind === TokenKind.Function) {
          token = this.createToken(TokenKind.StartParameters, c, this._index++)
        }
        // Logical grouping
        else {
          token = this.createToken(TokenKind.StartGroup, c, this._index++)
        }
        break
      case START_INDEX: // "["
        token = this.createToken(TokenKind.StartIndex, c, this._index++)
        break
      case END_GROUP: // ")"
        // Function call
        if (this._lastUnclosedToken?.kind === TokenKind.StartParameters) {
          // "(" function call
          token = this.createToken(TokenKind.EndParameters, c, this._index++)
        }
        // Logical grouping
        else {
          token = this.createToken(TokenKind.EndGroup, c, this._index++)
        }
        break
      case END_INDEX: // "]"
        token = this.createToken(TokenKind.EndIndex, c, this._index++)
        break
      case SEPARATOR: // ","
        token = this.createToken(TokenKind.Separator, c, this._index++)
        break
      case WILDCARD: // "*"
        token = this.createToken(TokenKind.Wildcard, c, this._index++)
        break
      case "'":
        token = this.readStringToken()
        break
      case "!": // "!" and "!="
      case ">": // ">" and ">="
      case "<": // "<" and "<="
      case "=": // "=="
      case "&": // "&&"
      case "|": // "||"
        token = this.readOperator()
        break
      default:
        if (c == ".") {
          // Number
          if (
            this._lastToken == null ||
            this._lastToken.kind == TokenKind.Separator || // ","
            this._lastToken.kind == TokenKind.StartGroup || // "(" logical grouping
            this._lastToken.kind == TokenKind.StartIndex || // "["
            this._lastToken.kind == TokenKind.StartParameters || // "(" function call
            this._lastToken.kind == TokenKind.LogicalOperator
          ) {
            // "!", "==", etc

            token = this.readNumberToken()
          }
          // "."
          else {
            token = this.createToken(TokenKind.Dereference, c, this._index++)
          }
        } else if (c == "-" || c == "+" || (c >= "0" && c <= "9")) {
          token = this.readNumberToken()
        } else {
          token = this.readKeywordToken()
        }

        break
    }

    this._lastToken = token
    return token
  }

  private readNumberToken(): Token {
    const startIndex = this._index
    do {
      this._index++
    } while (
      this._index < this._expression.length &&
      (!LexicalAnalyzer.testTokenBoundary(this._expression[this._index]) ||
        this._expression[this._index] === ".")
    )

    const length = this._index - startIndex
    const str = this._expression.substr(startIndex, length)
    const n = expressionUtility.parseNumber(str)

    if (isNaN(n)) {
      return this.createToken(TokenKind.Unexpected, str, startIndex)
    }

    return this.createToken(TokenKind.Number, str, startIndex, n)
  }

  private readKeywordToken(): Token {
    // Read to the end of the keyword
    const startIndex = this._index
    this._index++ // Skip the first char. It is already known to be the start of the keyword
    while (
      this._index < this._expression.length &&
      !LexicalAnalyzer.testTokenBoundary(this._expression[this._index])
    ) {
      this._index++
    }

    // Test if valid keyword character sequence
    const length = this._index - startIndex
    const str = this._expression.substr(startIndex, length)
    if (expressionUtility.testLegalKeyword(str)) {
      // Test if follows property dereference operator
      if (this._lastToken?.kind === TokenKind.Dereference) {
        return this.createToken(TokenKind.PropertyName, str, startIndex)
      }

      switch (str) {
        // Null
        case NULL:
          return this.createToken(TokenKind.Null, str, startIndex)
        // Boolean
        case TRUE:
          return this.createToken(TokenKind.Boolean, str, startIndex, true)
        case FALSE:
          return this.createToken(TokenKind.Boolean, str, startIndex, false)
        // NaN
        case NAN:
          return this.createToken(TokenKind.Number, str, startIndex, NaN)
        // Infinity
        case INFINITY:
          return this.createToken(TokenKind.Number, str, startIndex, Infinity)
      }

      // Lookahead
      let tempIndex = this._index
      while (
        tempIndex < this._expression.length &&
        /\s/.test(this._expression[tempIndex])
      ) {
        tempIndex++
      }

      // Function
      if (
        tempIndex < this._expression.length &&
        this._expression[tempIndex] == START_GROUP
      ) {
        // "("
        return this.createToken(TokenKind.Function, str, startIndex)
      }
      // Named-context
      else {
        return this.createToken(TokenKind.NamedContext, str, startIndex)
      }
    }
    // Invalid keyword
    else {
      return this.createToken(TokenKind.Unexpected, str, startIndex)
    }
  }

  private readStringToken() {
    const startIndex = this._index
    let c: string
    let closed = false
    let str = ""
    this._index++ // Skip the leading single-quote
    while (this._index < this._expression.length) {
      c = this._expression[this._index++]
      if (c === "'") {
        // End of string
        if (
          this._index >= this._expression.length ||
          this._expression[this._index] != "'"
        ) {
          closed = true
          break
        }

        // Escaped single quote
        this._index++
      }

      str += c
    }

    const length = this._index - startIndex
    const rawValue = this._expression.substr(startIndex, length)
    if (closed) {
      return this.createToken(TokenKind.String, rawValue, startIndex, str)
    }

    return this.createToken(TokenKind.Unexpected, rawValue, startIndex)
  }

  private readOperator(): Token {
    const startIndex = this._index
    let raw: string
    this._index++

    // Check for a two-character operator
    if (this._index < this._expression.length) {
      this._index++
      raw = this._expression.substr(startIndex, 2)
      switch (raw) {
        case NOT_EQUAL:
        case GREATER_THAN_OR_EQUAL:
        case LESS_THAN_OR_EQUAL:
        case EQUAL:
        case AND:
        case OR:
          return this.createToken(TokenKind.LogicalOperator, raw, startIndex)
      }

      // Backup
      this._index--
    }

    // Check for one-character operator
    raw = this._expression.substr(startIndex, 1)
    switch (raw) {
      case NOT:
      case GREATER_THAN:
      case LESS_THAN:
        return this.createToken(TokenKind.LogicalOperator, raw, startIndex)
    }

    // Unexpected
    while (
      this._index < this._expression.length &&
      !LexicalAnalyzer.testTokenBoundary(this._expression[this._index])
    ) {
      this._index++
    }

    const length = this._index - startIndex
    raw = this._expression.substr(startIndex, length)
    return this.createToken(TokenKind.Unexpected, raw, startIndex)
  }

  private createToken(
    kind: TokenKind,
    rawValue: string,
    index: number,
    parsedValue?: boolean | number | string
  ) {
    // Check whether the current token is legal based on the last token
    let legal = false
    switch (kind) {
      case TokenKind.StartGroup: // "(" logical grouping
        // Is first or follows "," or "(" or "[" or a logical operator
        legal = this.checkLastToken(
          undefined,
          TokenKind.Separator,
          TokenKind.StartGroup,
          TokenKind.StartParameters,
          TokenKind.StartIndex,
          TokenKind.LogicalOperator
        )
        break
      case TokenKind.StartIndex: // "["
        // Follows ")", "]", "*", a property name, or a named-context
        legal = this.checkLastToken(
          TokenKind.EndGroup,
          TokenKind.EndParameters,
          TokenKind.EndIndex,
          TokenKind.Wildcard,
          TokenKind.PropertyName,
          TokenKind.NamedContext
        )
        break
      case TokenKind.StartParameters: // "(" function call
        // Follows a function
        legal = this.checkLastToken(TokenKind.Function)
        break
      case TokenKind.EndGroup: // ")" logical grouping
        // Follows ")", "]", "*", a literal, a property name, or a named-context
        legal = this.checkLastToken(
          TokenKind.EndGroup,
          TokenKind.EndParameters,
          TokenKind.EndIndex,
          TokenKind.Wildcard,
          TokenKind.Null,
          TokenKind.Boolean,
          TokenKind.Number,
          TokenKind.String,
          TokenKind.PropertyName,
          TokenKind.NamedContext
        )
        break
      case TokenKind.EndIndex: // "]"
        // Follows ")", "]", "*", a literal, a property name, or a named-context
        legal = this.checkLastToken(
          TokenKind.EndGroup,
          TokenKind.EndParameters,
          TokenKind.EndIndex,
          TokenKind.Wildcard,
          TokenKind.Null,
          TokenKind.Boolean,
          TokenKind.Number,
          TokenKind.String,
          TokenKind.PropertyName,
          TokenKind.NamedContext
        )
        break
      case TokenKind.EndParameters: // ")" function call
        // Follows "(" function call, ")", "]", "*", a literal, a property name, or a named-context
        legal = this.checkLastToken(
          TokenKind.StartParameters,
          TokenKind.EndGroup,
          TokenKind.EndParameters,
          TokenKind.EndIndex,
          TokenKind.Wildcard,
          TokenKind.Null,
          TokenKind.Boolean,
          TokenKind.Number,
          TokenKind.String,
          TokenKind.PropertyName,
          TokenKind.NamedContext
        )
        break
      case TokenKind.Separator: // ","
        // Follows ")", "]", "*", a literal, a property name, or a named-context
        legal = this.checkLastToken(
          TokenKind.EndGroup,
          TokenKind.EndParameters,
          TokenKind.EndIndex,
          TokenKind.Wildcard,
          TokenKind.Null,
          TokenKind.Boolean,
          TokenKind.Number,
          TokenKind.String,
          TokenKind.PropertyName,
          TokenKind.NamedContext
        )
        break
      case TokenKind.Dereference: // "."
        // Follows ")", "]", "*", a property name, or a named-context
        legal = this.checkLastToken(
          TokenKind.EndGroup,
          TokenKind.EndParameters,
          TokenKind.EndIndex,
          TokenKind.Wildcard,
          TokenKind.PropertyName,
          TokenKind.NamedContext
        )
        break
      case TokenKind.Wildcard: // "*"
        // Follows "[" or "."
        legal = this.checkLastToken(TokenKind.StartIndex, TokenKind.Dereference)
        break
      case TokenKind.LogicalOperator: // "!", "==", etc
        switch (rawValue) {
          case NOT:
            // Is first or follows "," or "(" or "[" or a logical operator
            legal = this.checkLastToken(
              undefined,
              TokenKind.Separator,
              TokenKind.StartGroup,
              TokenKind.StartParameters,
              TokenKind.StartIndex,
              TokenKind.LogicalOperator
            )
            break
          default:
            // Follows ")", "]", "*", a literal, a property name, or a named-context
            legal = this.checkLastToken(
              TokenKind.EndGroup,
              TokenKind.EndParameters,
              TokenKind.EndIndex,
              TokenKind.Wildcard,
              TokenKind.Null,
              TokenKind.Boolean,
              TokenKind.Number,
              TokenKind.String,
              TokenKind.PropertyName,
              TokenKind.NamedContext
            )
            break
        }
        break
      case TokenKind.Null:
      case TokenKind.Boolean:
      case TokenKind.Number:
      case TokenKind.String:
        // Is first or follows "," or "[" or "(" or a logical operator (e.g. "!" or "==" etc)
        legal = this.checkLastToken(
          undefined,
          TokenKind.Separator,
          TokenKind.StartIndex,
          TokenKind.StartGroup,
          TokenKind.StartParameters,
          TokenKind.LogicalOperator
        )
        break
      case TokenKind.PropertyName:
        // Follows "."
        legal = this.checkLastToken(TokenKind.Dereference)
        break
      case TokenKind.Function:
        // Is first or follows "," or "[" or "(" or a logical operator (e.g. "!" or "==" etc)
        legal = this.checkLastToken(
          undefined,
          TokenKind.Separator,
          TokenKind.StartIndex,
          TokenKind.StartGroup,
          TokenKind.StartParameters,
          TokenKind.LogicalOperator
        )
        break
      case TokenKind.NamedContext:
        // Is first or follows "," or "[" or "(" or a logical operator (e.g. "!" or "==" etc)
        legal = this.checkLastToken(
          undefined,
          TokenKind.Separator,
          TokenKind.StartIndex,
          TokenKind.StartGroup,
          TokenKind.StartParameters,
          TokenKind.LogicalOperator
        )
        break
    }

    // Illegal
    if (!legal) {
      return new Token(TokenKind.Unexpected, rawValue, index)
    }

    // Legal so far
    const token = new Token(kind, rawValue, index, parsedValue)

    switch (kind) {
      case TokenKind.StartGroup: // "(" logical grouping
      case TokenKind.StartIndex: // "["
      case TokenKind.StartParameters: // "(" function call
        // Track start token
        this._unclosedTokens.push(token)
        break

      case TokenKind.EndGroup: // ")" logical grouping
        // Check inside logical grouping
        if (this._lastUnclosedToken?.kind !== TokenKind.StartGroup) {
          return new Token(TokenKind.Unexpected, rawValue, index)
        }

        // Pop start token
        this._unclosedTokens.pop()
        break

      case TokenKind.EndIndex: // "]"
        // Check inside indexer
        if (this._lastUnclosedToken?.kind != TokenKind.StartIndex) {
          return new Token(TokenKind.Unexpected, rawValue, index)
        }

        // Pop start token
        this._unclosedTokens.pop()
        break

      case TokenKind.EndParameters: // ")" function call
        // Check inside function call
        if (this._lastUnclosedToken?.kind !== TokenKind.StartParameters) {
          return new Token(TokenKind.Unexpected, rawValue, index)
        }

        // Pop start token
        this._unclosedTokens.pop()
        break

      case TokenKind.Separator: // ","
        // Check inside function call
        if (this._lastUnclosedToken?.kind !== TokenKind.StartParameters) {
          return new Token(TokenKind.Unexpected, rawValue, index)
        }
        break
    }

    return token
  }

  private checkLastToken(...allowed: (TokenKind | undefined)[]): boolean {
    const lastKind = this._lastToken?.kind
    return allowed.some((x) => x === lastKind)
  }

  private static testTokenBoundary(c: string): boolean {
    switch (c) {
      case START_GROUP: // "("
      case START_INDEX: // "["
      case END_GROUP: // ")"
      case END_INDEX: // "]"
      case SEPARATOR: // ","
      case DEREFERENCE: // "."
      case "!": // "!" and "!="
      case ">": // ">" and ">="
      case "<": // "<" and "<="
      case "=": // "=="
      case "&": // "&&"
      case "|": // "||"
        return true
      default:
        return /\s/.test(c)
    }
  }
}
