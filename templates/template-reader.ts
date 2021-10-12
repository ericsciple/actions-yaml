// template-reader *just* does schema validation

import {
  Definition,
  DefinitionType,
  MappingDefinition,
  ScalarDefinition,
  SequenceDefinition,
  TemplateSchema,
} from "./schema"
import {
  ANY,
  CLOSE_EXPRESSION,
  INSERT_DIRECTIVE,
  OPEN_EXPRESSION,
} from "./template-constants"
import { TemplateContext } from "./template-context"
import { TemplateMemory } from "./template-memory"
import {
  BasicExpressionToken,
  BASIC_EXPRESSION_TYPE,
  BOOLEAN_TYPE,
  ExpressionToken,
  InsertExpressionToken,
  LiteralToken,
  MappingToken,
  NULL_TYPE,
  NUMBER_TYPE,
  ObjectReader,
  ScalarToken,
  StringToken,
  STRING_TYPE,
  TemplateToken,
} from "./tokens"
import * as expressionUtility from "../expressions/expression-utility"

const WHITESPACE_PATTERN = /\s/

export function readTemplate(
  context: TemplateContext,
  type: string,
  objectReader: ObjectReader,
  fileId: number | undefined
): ReadTemplateResult {
  const reader = new TemplateReader(context, objectReader, fileId)
  const originalBytes = context.memory.currentBytes
  let value: TemplateToken | undefined
  try {
    objectReader.validateStart()
    const definition = new DefinitionInfo(context.schema, type)
    value = reader.readValue(definition)
    objectReader.validateEnd()
  } catch (err) {
    context.error(fileId, err)
  }

  return <ReadTemplateResult>{
    value: value,
    bytes: context.memory.currentBytes - originalBytes,
  }
}

export interface ReadTemplateResult {
  value: TemplateToken
  bytes: number
}

class TemplateReader {
  private readonly _context: TemplateContext
  private readonly _schema: TemplateSchema
  private readonly _memory: TemplateMemory
  private readonly _objectReader: ObjectReader
  private readonly _fileId: number | undefined

  public constructor(
    context: TemplateContext,
    objectReader: ObjectReader,
    fileId: number | undefined
  ) {
    this._context = context
    this._schema = context.schema
    this._memory = context.memory
    this._objectReader = objectReader
    this._fileId = fileId
  }

  public readValue(definition: DefinitionInfo): TemplateToken {
    // Scalar
    const literal = this._objectReader.allowLiteral()
    if (literal) {
      let scalar: ScalarToken = this.parseScalar(
        literal,
        definition.allowedContext
      )
      scalar = this.validate(scalar, definition)
      this._memory.addToken(scalar, false)
      return scalar
    }

    // Sequence
    const sequence = this._objectReader.allowSequenceStart()
    if (sequence) {
      this._memory.incrementDepth()
      this._memory.addToken(sequence, false)

      const sequenceDefinition = definition.getDefinitionsOfType(
        DefinitionType.Sequence
      )[0] as SequenceDefinition | undefined

      // Legal
      if (sequenceDefinition) {
        const itemDefinition = new DefinitionInfo(
          definition,
          sequenceDefinition.itemType
        )

        // Add each item
        while (!this._objectReader.allowSequenceEnd()) {
          const item = this.readValue(itemDefinition)
          sequence.add(item)
        }
      }
      // Illegal
      else {
        // Error
        this._context.error(sequence, "A sequence was not expected")

        // Skip each item
        while (!this._objectReader.allowSequenceEnd()) {
          this.skipValue()
        }
      }

      this._memory.decrementDepth()
      return sequence
    }

    // Mapping
    const mapping = this._objectReader.allowMappingStart()
    if (mapping) {
      this._memory.incrementDepth()
      this._memory.addToken(mapping, false)

      const mappingDefinitions = definition.getDefinitionsOfType(
        DefinitionType.Mapping
      ) as MappingDefinition[]

      // Legal
      if (mappingDefinitions.length > 0) {
        if (
          mappingDefinitions.length > 1 ||
          Object.keys(mappingDefinitions[0].properties).length > 0 ||
          !mappingDefinitions[0].looseKeyType
        ) {
          this.handleMappingWithWellKnownProperties(
            definition,
            mappingDefinitions,
            mapping
          )
        } else {
          const keyDefinition = new DefinitionInfo(
            definition,
            mappingDefinitions[0].looseKeyType
          )
          const valueDefinition = new DefinitionInfo(
            definition,
            mappingDefinitions[0].looseValueType
          )
          this.handleMappingWithAllLooseProperties(
            definition,
            keyDefinition,
            valueDefinition,
            mapping
          )
        }
      }
      // Illegal
      else {
        this._context.error(mapping, "A mapping was not expected")

        while (this._objectReader.allowMappingEnd()) {
          this.skipValue()
          this.skipValue()
        }
      }

      this._memory.decrementDepth()
      return mapping
    }

    throw new Error("Expected a scalar value, a sequence, or a mapping")
  }

  private handleMappingWithWellKnownProperties(
    definition: DefinitionInfo,
    mappingDefinitions: MappingDefinition[],
    mapping: MappingToken
  ): void {
    // Check if loose properties are allowed
    let looseKeyType: string | undefined
    let looseValueType: string | undefined
    let looseKeyDefinition: DefinitionInfo | undefined
    let looseValueDefinition: DefinitionInfo | undefined
    if (mappingDefinitions[0].looseKeyType) {
      looseKeyType = mappingDefinitions[0].looseKeyType
      looseValueType = mappingDefinitions[0].looseValueType
    }

    const upperKeys: { [upperKey: string]: boolean } = {}
    let hasExpressionKey = false

    let rawLiteral: LiteralToken | undefined
    while ((rawLiteral = this._objectReader.allowLiteral())) {
      const nextKeyScalar = this.parseScalar(
        rawLiteral,
        definition.allowedContext
      )

      // Expression
      if (nextKeyScalar.isExpression) {
        hasExpressionKey = true

        // Legal
        if (definition.allowedContext.length > 0) {
          this._memory.addToken(nextKeyScalar, false)
          const anyDefinition = new DefinitionInfo(definition, ANY)
          mapping.add(nextKeyScalar, this.readValue(anyDefinition))
        }
        // Illegal
        else {
          this._context.error(
            nextKeyScalar,
            "A template expression is not allowed in this context"
          )
          this.skipValue()
        }

        continue
      }

      // Convert to StringToken if required
      const nextKey =
        nextKeyScalar.templateTokenType === STRING_TYPE
          ? (nextKeyScalar as StringToken)
          : new StringToken(
              nextKeyScalar.fileId,
              nextKeyScalar.line,
              nextKeyScalar.col,
              nextKeyScalar.toString()
            )

      // Duplicate
      const upperKey = nextKey.value.toUpperCase()
      if (upperKeys[upperKey]) {
        this._context.error(nextKey, `'${nextKey.value}' is already defined`)
        this.skipValue()
        continue
      }
      upperKeys[upperKey] = true

      // Well known
      const nextValueType = this._schema.matchPropertyAndFilter(
        mappingDefinitions,
        nextKey.value
      )
      if (nextValueType) {
        this._memory.addToken(nextKey, false)
        const nextValueDefinition = new DefinitionInfo(
          definition,
          nextValueType
        )
        const nextValue = this.readValue(nextValueDefinition)
        mapping.add(nextKey, nextValue)
        continue
      }

      // Loose
      if (looseKeyType) {
        if (!looseKeyDefinition) {
          looseKeyDefinition = new DefinitionInfo(definition, looseKeyType)
          looseValueDefinition = new DefinitionInfo(definition, looseValueType!)
        }

        this.validate(nextKey, looseKeyDefinition)
        this._memory.addToken(nextKey, false)
        const nextValue = this.readValue(looseValueDefinition!)
        mapping.add(nextKey, nextValue)
        continue
      }

      // Error
      this._context.error(nextKey, `Unexpected value '${nextKey.value}'`)
      this.skipValue()
    }

    // Unable to filter to one definition
    if (mappingDefinitions.length > 1) {
      const hitCount: { [key: string]: number } = {}
      for (const mappingDefinition of mappingDefinitions) {
        for (const key of Object.keys(mappingDefinition.properties)) {
          hitCount[key] = (hitCount[key] ?? 0) + 1
        }
      }

      const nonDuplicates: string[] = []
      for (const key of Object.keys(hitCount)) {
        if (hitCount[key] === 1) {
          nonDuplicates.push(key)
        }
      }

      this._context.error(
        mapping,
        `There's not enough info to determine what you meant. Add one of these properties: ${nonDuplicates
          .sort()
          .join(", ")}`
      )
    }
    // Check required properties
    else if (mappingDefinitions.length === 1 && !hasExpressionKey) {
      for (const propertyName of Object.keys(
        mappingDefinitions[0].properties
      )) {
        const propertyValue = mappingDefinitions[0].properties[propertyName]
        if (propertyValue.required && !upperKeys[propertyName.toUpperCase()]) {
          this._context.error(
            mapping,
            `Required property is missing: ${propertyName}`
          )
        }
      }
    }

    this.expectMappingEnd()
  }

  private handleMappingWithAllLooseProperties(
    mappingDefinition: DefinitionInfo,
    keyDefinition: DefinitionInfo,
    valueDefinition: DefinitionInfo,
    mapping: MappingToken
  ): void {
    let nextValue: TemplateToken
    const upperKeys: { [key: string]: boolean } = {}

    let rawLiteral: LiteralToken | undefined
    while ((rawLiteral = this._objectReader.allowLiteral())) {
      const nextKeyScalar = this.parseScalar(
        rawLiteral,
        mappingDefinition.allowedContext
      )

      // Expression
      if (nextKeyScalar.isExpression) {
        // Legal
        if (mappingDefinition.allowedContext.length > 0) {
          this._memory.addToken(nextKeyScalar, false)
          nextValue = this.readValue(valueDefinition)
          mapping.add(nextKeyScalar, nextValue)
        }
        // Illegal
        else {
          this._context.error(
            nextKeyScalar,
            "A template expression is not allowed in this context"
          )
          this.skipValue()
        }

        continue
      }

      // Convert to StringToken if required
      const nextKey =
        nextKeyScalar.templateTokenType === STRING_TYPE
          ? (nextKeyScalar as StringToken)
          : new StringToken(
              nextKeyScalar.fileId,
              nextKeyScalar.line,
              nextKeyScalar.col,
              nextKeyScalar.toString()
            )

      // Duplicate
      const upperKey = nextKey.value.toUpperCase()
      if (upperKeys[upperKey]) {
        this._context.error(nextKey, `'${nextKey.value}' is already defined`)
        this.skipValue()
        continue
      }
      upperKeys[upperKey] = true

      // Validate
      this.validate(nextKey, keyDefinition)
      this._memory.addToken(nextKey, false)

      // Add the pair
      nextValue = this.readValue(valueDefinition)
      mapping.add(nextKey, nextValue)
    }

    this.expectMappingEnd()
  }

  private expectMappingEnd(): void {
    if (!this._objectReader.allowMappingEnd()) {
      throw new Error("Expected mapping end") // Should never happen
    }
  }

  private skipValue(): void {
    // Scalar
    if (this._objectReader.allowLiteral()) {
      // Intentionally empty
    }
    // Sequence
    else if (this._objectReader.allowSequenceStart()) {
      this._memory.incrementDepth()
      while (!this._objectReader.allowSequenceEnd()) {
        this.skipValue()
      }
      this._memory.decrementDepth()
    }
    // Mapping
    else if (this._objectReader.allowMappingStart()) {
      this._memory.incrementDepth()
      while (!this._objectReader.allowMappingEnd()) {
        this.skipValue()
        this.skipValue()
      }
      this._memory.decrementDepth()
    }
    // Unexpected
    else {
      throw new Error("Expected a scalar value, a sequence, or a mapping")
    }
  }

  private validate(
    scalar: ScalarToken,
    definition: DefinitionInfo
  ): ScalarToken {
    switch (scalar.templateTokenType) {
      case NULL_TYPE:
      case BOOLEAN_TYPE:
      case NUMBER_TYPE:
      case STRING_TYPE: {
        const literal = scalar as LiteralToken

        // Legal
        const scalarDefinitions = definition.getScalarDefinitions()
        if (scalarDefinitions.some((x) => x.isMatch(literal))) {
          return scalar
        }

        // Not a string, convert
        if (literal.templateTokenType !== STRING_TYPE) {
          const stringLiteral = new StringToken(
            literal.fileId,
            literal.line,
            literal.col,
            literal.toString()
          )

          // Legal
          if (scalarDefinitions.some((x) => x.isMatch(stringLiteral))) {
            return stringLiteral
          }
        }

        // Illegal
        this._context.error(literal, `Unexpected value '${literal.toString()}'`)
        return scalar
      }
      case BASIC_EXPRESSION_TYPE:
        // Illegal
        if (definition.allowedContext.length === 0) {
          this._context.error(
            scalar,
            "A template expression is not allowed in this context"
          )
        }

        return scalar
      default:
        this._context.error(scalar, `Unexpected value '${scalar.toString()}'`)
        return scalar
    }
  }

  private parseScalar(
    token: LiteralToken,
    allowedContext: string[]
  ): ScalarToken {
    // Not a string
    if (token.templateTokenType !== STRING_TYPE) {
      return token
    }

    // Check if the value is definitely a literal
    const raw = token.toString()
    let startExpression: number = raw.indexOf(OPEN_EXPRESSION)
    if (startExpression < 0) {
      // Doesn't contain "${{"
      return token
    }

    // Break the value into segments of LiteralToken and ExpressionToken
    const segments: ScalarToken[] = []
    let i = 0
    while (i < raw.length) {
      // An expression starts here
      if (i === startExpression) {
        // Find the end of the expression - i.e. "}}"
        startExpression = i
        let endExpression = -1
        let inString = false
        for (i += OPEN_EXPRESSION.length; i < raw.length; i++) {
          if (raw[i] === "'") {
            inString = !inString // Note, this handles escaped single quotes gracefully. E.x. 'foo''bar'
          } else if (!inString && raw[i] === "}" && raw[i - 1] === "}") {
            endExpression = i
            i++
            break
          }
        }

        // Check if not closed
        if (endExpression < startExpression) {
          this._context.error(
            token,
            "The expression is not closed. An unescaped ${{ sequence was found, but the closing }} sequence was not found."
          )
          return token
        }

        // Parse the expression
        const rawExpression = raw.substr(
          startExpression + OPEN_EXPRESSION.length,
          endExpression -
            startExpression +
            1 -
            OPEN_EXPRESSION.length -
            CLOSE_EXPRESSION.length
        )
        const parseExpressionResult = this.parseExpression(
          token.line,
          token.col,
          rawExpression,
          allowedContext
        )

        // Check for error
        if (parseExpressionResult.error) {
          this._context.error(token, parseExpressionResult.error)
          return token
        }

        // Check if a directive was used when not allowed
        const expression = parseExpressionResult.expression as ExpressionToken
        if (expression.directive && (startExpression !== 0 || i < raw.length)) {
          this._context.error(
            token,
            `The directive '${expression.directive}' is not allowed in this context. Directives are not supported for expressions that are embedded within a string. Directives are only supported when the entire value is an expression.`
          )
          return token
        }

        // Add the segment
        segments.push(expression)

        // Look for the next expression
        startExpression = raw.indexOf(OPEN_EXPRESSION, i)
      }
      // The next expression is further ahead
      else if (i < startExpression) {
        // Append the segment
        this.addString(
          segments,
          token.line,
          token.col,
          raw.substr(i, startExpression - i)
        )

        // Adjust the position
        i = startExpression
      }
      // No remaining expressions
      else {
        this.addString(segments, token.line, token.col, raw.substr(i))
        break
      }
    }

    // Check if can convert to a literal
    // For example, the escaped expression: ${{ '{{ this is a literal }}' }}
    if (
      segments.length === 1 &&
      segments[0].templateTokenType === BASIC_EXPRESSION_TYPE
    ) {
      const basicExpression = segments[0] as BasicExpressionToken
      const str = this.getExpressionString(basicExpression.expression)
      if (str !== undefined) {
        return new StringToken(this._fileId, token.line, token.col, str)
      }
    }

    // Check if only one segment
    if (segments.length === 1) {
      return segments[0]
    }

    // Build the new expression, using the format function
    const format: string[] = []
    const args: string[] = []
    let argIndex = 0
    for (const segment of segments) {
      if (segment.templateTokenType === STRING_TYPE) {
        const literal = segment as StringToken
        const text = expressionUtility
          .stringEscape(literal.value) // Escape quotes
          .replace(/\{/g, "{{") // Escape braces
          .replace(/\}/g, "}}")
        format.push(text)
      } else {
        format.push(`{${argIndex}}`) // Append format arg
        argIndex++

        const expression = segment as BasicExpressionToken
        args.push(", ")
        args.push(expression.expression)
      }
    }

    return new BasicExpressionToken(
      this._fileId,
      token.line,
      token.col,
      `format('${format.join("")}'${args.join("")})`
    )
  }

  private parseExpression(
    line: number | undefined,
    column: number | undefined,
    value: string,
    allowedContext: string[]
  ): ParseExpressionResult {
    const trimmed = value.trim()

    // Check if the value is empty
    if (!trimmed) {
      return <ParseExpressionResult>{
        error: new Error("An expression was expected"),
      }
    }

    // Try to find a matching directive
    const matchDirectiveResult = this.matchDirective(
      trimmed,
      INSERT_DIRECTIVE,
      0
    )
    if (matchDirectiveResult.isMatch) {
      return <ParseExpressionResult>{
        expression: new InsertExpressionToken(this._fileId, line, column),
      }
    } else if (matchDirectiveResult.error) {
      return <ParseExpressionResult>{
        error: matchDirectiveResult.error,
      }
    }

    // Check if valid expression
    try {
      ExpressionToken.validateExpression(trimmed, allowedContext)
    } catch (err) {
      return <ParseExpressionResult>{
        error: err,
      }
    }

    // Return the expression
    return <ParseExpressionResult>{
      expression: new BasicExpressionToken(this._fileId, line, column, trimmed),
      error: undefined,
    }
  }

  private addString(
    segments: ScalarToken[],
    line: number | undefined,
    column: number | undefined,
    value: string
  ): void {
    // If the last segment was a LiteralToken, then append to the last segment
    if (
      segments.length > 0 &&
      segments[segments.length - 1].templateTokenType === STRING_TYPE
    ) {
      const lastSegment = segments[segments.length - 1] as StringToken
      segments[segments.length - 1] = new StringToken(
        this._fileId,
        line,
        column,
        `${lastSegment.value}${value}`
      )
    }
    // Otherwise add a new LiteralToken
    else {
      segments.push(new StringToken(this._fileId, line, column, value))
    }
  }

  private matchDirective(
    trimmed: string,
    directive: string,
    expectedParameters: number
  ): MatchDirectiveResult {
    const parameters: string[] = []
    if (
      trimmed.startsWith(directive) &&
      (trimmed.length === directive.length ||
        WHITESPACE_PATTERN.test(trimmed[directive.length]))
    ) {
      let startIndex = directive.length
      let inString = false
      let parens = 0
      for (let i = startIndex; i < trimmed.length; i++) {
        const c = trimmed[i]
        if (WHITESPACE_PATTERN.test(c) && !inString && parens == 0) {
          if (startIndex < 1) {
            parameters.push(trimmed.substr(startIndex, i - startIndex))
          }

          startIndex = i + 1
        } else if (c === "'") {
          inString = !inString
        } else if (c === "(" && !inString) {
          parens++
        } else if (c === ")" && !inString) {
          parens--
        }
      }

      if (startIndex < trimmed.length) {
        parameters.push(trimmed.substr(startIndex))
      }

      if (expectedParameters != parameters.length) {
        return <MatchDirectiveResult>{
          isMatch: false,
          parameters: [],
          error: new Error(
            `Exactly ${expectedParameters} parameter(s) were expected following the directive '${directive}'. Actual parameter count: ${parameters.length}`
          ),
        }
      }

      return <MatchDirectiveResult>{
        isMatch: true,
        parameters: parameters,
      }
    }

    return <MatchDirectiveResult>{
      isMatch: false,
      parameters: parameters,
    }
  }

  private getExpressionString(trimmed: string): string | undefined {
    const result: string[] = []

    let inString = false
    for (let i = 0; i < trimmed.length; i++) {
      const c = trimmed[i]
      if (c === "'") {
        inString = !inString
        if (inString && i !== 0) {
          result.push(c)
        }
      } else if (!inString) {
        return undefined
      } else {
        result.push(c)
      }
    }

    return result.join("")
  }
}

interface ParseExpressionResult {
  expression: ExpressionToken | undefined
  error: Error | undefined
}

interface MatchDirectiveResult {
  isMatch: boolean
  parameters: string[]
  error: Error | undefined
}

class DefinitionInfo {
  private readonly _schema: TemplateSchema
  public readonly isDefinitionInfo = true
  public readonly definition: Definition
  public readonly allowedContext: string[]

  public constructor(schema: TemplateSchema, name: string)
  public constructor(parent: DefinitionInfo, name: string)
  public constructor(
    schemaOrParent: TemplateSchema | DefinitionInfo,
    name: string
  ) {
    const parent: DefinitionInfo | undefined =
      (schemaOrParent as DefinitionInfo | undefined)?.isDefinitionInfo === true
        ? (schemaOrParent as DefinitionInfo)
        : undefined
    this._schema =
      parent === undefined ? (schemaOrParent as TemplateSchema) : parent._schema

    // Lookup the definition
    this.definition = this._schema.getDefinition(name)

    // Record allowed context
    if (this.definition.readerContext.length > 0) {
      this.allowedContext = []

      // Copy parent allowed context
      const upperSeen: { [upper: string]: boolean } = {}
      for (const context of parent?.allowedContext ?? []) {
        this.allowedContext.push(context)
        upperSeen[context.toUpperCase()] = true
      }

      // Append context if unseen
      for (const context of this.definition.readerContext) {
        const upper = context.toUpperCase()
        if (!upperSeen[upper]) {
          this.allowedContext.push(context)
          upperSeen[upper] = true
        }
      }
    } else {
      this.allowedContext = parent?.allowedContext ?? []
    }
  }

  public getScalarDefinitions(): ScalarDefinition[] {
    return this._schema.getScalarDefinitions(this.definition)
  }

  public getDefinitionsOfType(type: DefinitionType): Definition[] {
    return this._schema.getDefinitionsOfType(this.definition, type)
  }
}
