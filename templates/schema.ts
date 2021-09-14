import {
  ANY,
  BOOLEAN,
  BOOLEAN_DEFINITION,
  BOOLEAN_DEFINITION_PROPERTIES,
  CONSTANT,
  CONTEXT,
  DEFINITION,
  DEFINITIONS,
  DESCRIPTION,
  IGNORE_CASE,
  ITEM_TYPE,
  LOOSE_KEY_TYPE,
  LOOSE_VALUE_TYPE,
  MAPPING,
  MAPPING_DEFINITION,
  MAPPING_DEFINITION_PROPERTIES,
  MAPPING_PROPERTY_VALUE,
  NON_EMPTY_STRING,
  NULL,
  NULL_DEFINITION,
  NULL_DEFINITION_PROPERTIES,
  NUMBER,
  NUMBER_DEFINITION,
  NUMBER_DEFINITION_PROPERTIES,
  ONE_OF,
  ONE_OF_DEFINITION,
  PROPERTIES,
  PROPERTY_VALUE,
  REQUIRED,
  REQUIRE_NON_EMPTY,
  SCALAR,
  SEQUENCE,
  SEQUENCE_DEFINITION,
  SEQUENCE_DEFINITION_PROPERTIES,
  SEQUENCE_OF_NON_EMPTY_STRING,
  STRING,
  STRING_DEFINITION,
  STRING_DEFINITION_PROPERTIES,
  TEMPLATE_SCHEMA,
  TYPE,
  VERSION,
} from "./template-constants"
import { TemplateContext, TemplateValidationErrors } from "./template-context"
import { TemplateMemory } from "./template-memory"
import { readTemplate } from "./template-reader"
import {
  BOOLEAN_TYPE,
  LiteralToken,
  MappingToken,
  NULL_TYPE,
  NUMBER_TYPE,
  ObjectReader,
  StringToken,
  STRING_TYPE,
  TemplateToken,
} from "./tokens"
import { NoOperationTraceWriter } from "./trace-writer"

export enum DefinitionType {
  Null,
  Boolean,
  Number,
  String,
  Sequence,
  Mapping,
  OneOf,
}

/**
 * This models the root schema object and contains definitions
 */
export class TemplateSchema {
  private static readonly _definitionNamePattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/
  private static _internalSchema: TemplateSchema | undefined
  public readonly definitions: { [key: string]: Definition } = {}
  public readonly version: string = ""

  public constructor(mapping?: MappingToken) {
    // Add built-in type: null
    this.definitions[NULL] = new NullDefinition()

    // Add built-in type: boolean
    this.definitions[BOOLEAN] = new BooleanDefinition()

    // Add built-in type: number
    this.definitions[NUMBER] = new NumberDefinition()

    // Add built-in type: string
    this.definitions[STRING] = new StringDefinition()

    // Add built-in type: sequence
    const sequenceDefinition = new SequenceDefinition()
    sequenceDefinition.itemType = ANY
    this.definitions[SEQUENCE] = sequenceDefinition

    // Add built-in type: mapping
    const mappingDefinition = new MappingDefinition()
    mappingDefinition.looseKeyType = STRING
    mappingDefinition.looseValueType = ANY
    this.definitions[MAPPING] = mappingDefinition

    // Add built-in type: any
    const anyDefinition = new OneOfDefinition()
    anyDefinition.oneOf.push(NULL)
    anyDefinition.oneOf.push(BOOLEAN)
    anyDefinition.oneOf.push(NUMBER)
    anyDefinition.oneOf.push(STRING)
    anyDefinition.oneOf.push(SEQUENCE)
    anyDefinition.oneOf.push(MAPPING)
    this.definitions[ANY] = anyDefinition

    if (mapping) {
      for (let i = 0; i < mapping.count; i++) {
        const pair = mapping.get(i)
        const key = pair.key.assertString(`${TEMPLATE_SCHEMA} key`)
        switch (key.value) {
          case VERSION: {
            this.version = pair.value.assertString(
              `${TEMPLATE_SCHEMA} ${VERSION}`
            ).value
            break
          }
          case DEFINITIONS: {
            const definitions = pair.value.assertMapping(
              `${TEMPLATE_SCHEMA} ${DEFINITIONS}`
            )
            for (let j = 0; j < definitions.count; j++) {
              const definitionsPair = definitions.get(j)
              const definitionsKey = definitionsPair.key.assertString(
                `${TEMPLATE_SCHEMA} ${DEFINITIONS} key`
              )
              const definitionsValue = definitionsPair.value.assertMapping(
                `${TEMPLATE_SCHEMA} ${DEFINITIONS} value`
              )
              let definition: Definition | undefined
              for (let k = 0; k < definitionsValue.count; k++) {
                const definitionPair = definitionsValue.get(k)
                const definitionKey = definitionPair.key.assertString(
                  `${DEFINITION} key`
                )
                switch (definitionKey.value) {
                  case NULL:
                    definition = new NullDefinition(definitionsValue)
                    break
                  case BOOLEAN:
                    definition = new BooleanDefinition(definitionsValue)
                    break
                  case NUMBER:
                    definition = new NumberDefinition(definitionsValue)
                    break
                  case STRING:
                    definition = new StringDefinition(definitionsValue)
                    break
                  case SEQUENCE:
                    definition = new SequenceDefinition(definitionsValue)
                    break
                  case MAPPING:
                    definition = new MappingDefinition(definitionsValue)
                    break
                  case ONE_OF:
                    definition = new OneOfDefinition(definitionsValue)
                    break
                  case CONTEXT:
                  case DESCRIPTION:
                    continue
                  default:
                    definitionKey.assertUnexpectedValue(
                      `${DEFINITION} mapping key`
                    ) // throws
                    break
                }

                break
              }

              if (!definition) {
                throw new Error(
                  `Not enough information to construct definition '${definitionsKey.value}'`
                )
              }

              this.definitions[definitionsKey.value] = definition
            }
            break
          }
          default:
            key.assertUnexpectedValue(`${TEMPLATE_SCHEMA} key`) // throws
            break
        }
      }
    }
  }

  /**
   * Looks up a definition by name
   */
  public getDefinition(name: string): Definition {
    const result = this.definitions[name]
    if (result) {
      return result
    }

    throw new Error(`Schema definition '${name}' not found`)
  }

  /**
   * Expands one-of definitions and returns all scalar definitions
   */
  public getScalarDefinitions(definition: Definition): ScalarDefinition[] {
    const result: ScalarDefinition[] = []
    switch (definition.definitionType) {
      case DefinitionType.Null:
      case DefinitionType.Boolean:
      case DefinitionType.Number:
      case DefinitionType.String:
        result.push(definition as ScalarDefinition)
        break
      case DefinitionType.OneOf: {
        const oneOf = definition as OneOfDefinition
        for (const nestedName of oneOf.oneOf) {
          const nestedDefinition = this.getDefinition(nestedName)
          switch (nestedDefinition.definitionType) {
            case DefinitionType.Null:
            case DefinitionType.Boolean:
            case DefinitionType.Number:
            case DefinitionType.String:
              result.push(nestedDefinition as ScalarDefinition)
              break
          }
        }
        break
      }
    }

    return result
  }

  /**
   * Expands one-of definitions and returns all matching definitions by type
   */
  public getDefinitionsOfType(
    definition: Definition,
    type: DefinitionType
  ): Definition[] {
    const result: Definition[] = []
    if (definition.definitionType === type) {
      result.push(definition)
    } else if (definition.definitionType === DefinitionType.OneOf) {
      const oneOf = definition as OneOfDefinition
      for (const nestedName of oneOf.oneOf) {
        const nestedDefinition = this.getDefinition(nestedName)
        if (nestedDefinition.definitionType === type) {
          result.push(nestedDefinition)
        }
      }
    }

    return result
  }

  /**
   * Attempts match the property name to a property defined by any of the specified definitions.
   * If matched, any unmatching definitions are filtered from the definitions array.
   * Returns the type information for the matched property.
   */
  public matchPropertyAndFilter(
    definitions: MappingDefinition[],
    propertyName: string
  ): string | undefined {
    let result: string | undefined

    // Check for a matching well-known property
    let notFoundInSome = false
    for (const definition of definitions) {
      const propertyValue = definition.properties[propertyName]
      if (propertyValue) {
        result = propertyValue.type
      } else {
        notFoundInSome = true
      }
    }

    // Filter the matched definitions if needed
    if (result && notFoundInSome) {
      for (let i = 0; i < definitions.length; ) {
        if (definitions[i].properties[propertyName]) {
          i++
        } else {
          definitions.splice(i, 1)
        }
      }
    }

    return result
  }

  private validate(): void {
    const oneOfDefinitions: { [key: string]: OneOfDefinition } = {}

    for (const name of Object.keys(this.definitions)) {
      if (!name.match(TemplateSchema._definitionNamePattern)) {
        throw new Error(`Invalid definition name '${name}'`)
      }

      const definition = this.definitions[name]

      // Delay validation for 'one-of' definitions
      if (definition.definitionType === DefinitionType.OneOf) {
        oneOfDefinitions[name] = definition as OneOfDefinition
      }
      // Otherwise validate now
      else {
        definition.validate(this, name)
      }
    }

    // Validate 'one-of' definitions
    for (const name of Object.keys(oneOfDefinitions)) {
      const oneOf = oneOfDefinitions[name]
      oneOf.validate(this, name)
    }
  }

  /**
   * Loads a user-defined schema file
   */
  public static load(objectReader: ObjectReader): TemplateSchema {
    const context = new TemplateContext(
      new TemplateValidationErrors(10, 500),
      new TemplateMemory(50, 1048576),
      TemplateSchema.getInternalSchema(),
      new NoOperationTraceWriter()
    )
    const readTemplateResult = readTemplate(
      context,
      TEMPLATE_SCHEMA,
      objectReader,
      undefined
    )
    context.errors.check()

    const mapping = readTemplateResult.value.assertMapping(TEMPLATE_SCHEMA)
    const schema = new TemplateSchema(mapping)
    schema.validate()
    return schema
  }

  /**
   * Gets the internal schema used for reading user-defined schema files
   */
  private static getInternalSchema(): TemplateSchema {
    if (TemplateSchema._internalSchema === undefined) {
      const schema = new TemplateSchema()

      // template-schema
      let mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[VERSION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, NON_EMPTY_STRING)
      )
      mappingDefinition.properties[DEFINITIONS] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, DEFINITIONS)
      )
      schema.definitions[TEMPLATE_SCHEMA] = mappingDefinition

      // definitions
      mappingDefinition = new MappingDefinition()
      mappingDefinition.looseKeyType = NON_EMPTY_STRING
      mappingDefinition.looseValueType = DEFINITION
      schema.definitions[DEFINITIONS] = mappingDefinition

      // definition
      let oneOfDefinition = new OneOfDefinition()
      oneOfDefinition.oneOf.push(NULL_DEFINITION)
      oneOfDefinition.oneOf.push(BOOLEAN_DEFINITION)
      oneOfDefinition.oneOf.push(NUMBER_DEFINITION)
      oneOfDefinition.oneOf.push(STRING_DEFINITION)
      oneOfDefinition.oneOf.push(SEQUENCE_DEFINITION)
      oneOfDefinition.oneOf.push(MAPPING_DEFINITION)
      oneOfDefinition.oneOf.push(ONE_OF_DEFINITION)
      schema.definitions[DEFINITION] = oneOfDefinition

      // null-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[NULL] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          NULL_DEFINITION_PROPERTIES
        )
      )
      schema.definitions[NULL_DEFINITION] = mappingDefinition

      // null-definition-properties
      mappingDefinition = new MappingDefinition()
      schema.definitions[NULL_DEFINITION_PROPERTIES] = mappingDefinition

      // boolean-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[BOOLEAN] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          BOOLEAN_DEFINITION_PROPERTIES
        )
      )
      schema.definitions[BOOLEAN_DEFINITION] = mappingDefinition

      // boolean-definition-properties
      mappingDefinition = new MappingDefinition()
      schema.definitions[BOOLEAN_DEFINITION_PROPERTIES] = mappingDefinition

      // number-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[NUMBER] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          NUMBER_DEFINITION_PROPERTIES
        )
      )
      schema.definitions[NUMBER_DEFINITION] = mappingDefinition

      // number-definition-properties
      mappingDefinition = new MappingDefinition()
      schema.definitions[NUMBER_DEFINITION_PROPERTIES] = mappingDefinition

      // string-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[STRING] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          STRING_DEFINITION_PROPERTIES
        )
      )
      schema.definitions[STRING_DEFINITION] = mappingDefinition

      // string-definition-properties
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[CONSTANT] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, NON_EMPTY_STRING)
      )
      mappingDefinition.properties[IGNORE_CASE] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, BOOLEAN)
      )
      mappingDefinition.properties[REQUIRE_NON_EMPTY] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, BOOLEAN)
      )
      schema.definitions[STRING_DEFINITION_PROPERTIES] = mappingDefinition

      // sequence-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[SEQUENCE] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_DEFINITION_PROPERTIES
        )
      )
      schema.definitions[SEQUENCE_DEFINITION] = mappingDefinition

      // sequence-definition-properties
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[ITEM_TYPE] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, NON_EMPTY_STRING)
      )
      schema.definitions[SEQUENCE_DEFINITION_PROPERTIES] = mappingDefinition

      // mapping-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[MAPPING] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          MAPPING_DEFINITION_PROPERTIES
        )
      )
      schema.definitions[MAPPING_DEFINITION] = mappingDefinition

      // mapping-definition-properties
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[PROPERTIES] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, PROPERTIES)
      )
      mappingDefinition.properties[LOOSE_KEY_TYPE] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, NON_EMPTY_STRING)
      )
      mappingDefinition.properties[LOOSE_VALUE_TYPE] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, NON_EMPTY_STRING)
      )
      schema.definitions[MAPPING_DEFINITION_PROPERTIES] = mappingDefinition

      // properties
      mappingDefinition = new MappingDefinition()
      mappingDefinition.looseKeyType = NON_EMPTY_STRING
      mappingDefinition.looseValueType = PROPERTY_VALUE
      schema.definitions[PROPERTIES] = mappingDefinition

      // property-value
      oneOfDefinition = new OneOfDefinition()
      oneOfDefinition.oneOf.push(NON_EMPTY_STRING)
      oneOfDefinition.oneOf.push(MAPPING_PROPERTY_VALUE)
      schema.definitions[PROPERTY_VALUE] = oneOfDefinition

      // mapping-property-value
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[TYPE] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, NON_EMPTY_STRING)
      )
      mappingDefinition.properties[REQUIRED] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, BOOLEAN)
      )
      schema.definitions[MAPPING_PROPERTY_VALUE] = mappingDefinition

      // one-of-definition
      mappingDefinition = new MappingDefinition()
      mappingDefinition.properties[DESCRIPTION] = new PropertyValue(
        new StringToken(undefined, undefined, undefined, STRING)
      )
      mappingDefinition.properties[CONTEXT] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      mappingDefinition.properties[ONE_OF] = new PropertyValue(
        new StringToken(
          undefined,
          undefined,
          undefined,
          SEQUENCE_OF_NON_EMPTY_STRING
        )
      )
      schema.definitions[ONE_OF_DEFINITION] = mappingDefinition

      // non-empty-string
      const stringDefinition = new StringDefinition()
      stringDefinition.requireNonEmpty = true
      schema.definitions[NON_EMPTY_STRING] = stringDefinition

      // sequence-of-non-empty-string
      const sequenceDefinition = new SequenceDefinition()
      sequenceDefinition.itemType = NON_EMPTY_STRING
      schema.definitions[SEQUENCE_OF_NON_EMPTY_STRING] = sequenceDefinition

      schema.validate()

      TemplateSchema._internalSchema = schema
    }

    return TemplateSchema._internalSchema
  }
}

/**
 * Defines the allowable schema for a user defined type
 */
export abstract class Definition {
  /**
   * Used by the template reader to determine allowed expression values and functions.
   * Also used by the template reader to validate function min/max parameters.
   */
  public readonly readerContext: string[] = []

  /**
   * Used by the template evaluator to determine allowed expression values and functions.
   * The min/max parameter info is omitted.
   */
  public readonly evaluatorContext: string[] = []

  public constructor(definition?: MappingToken) {
    if (definition) {
      for (let i = 0; i < definition.count; ) {
        const definitionKey = definition
          .get(i)
          .key.assertString(`${DEFINITION} key`)
        switch (definitionKey.value) {
          case CONTEXT: {
            const context = definition
              .get(i)
              .key.assertSequence(`${DEFINITION} key`)
            definition.remove(i)
            const seenReaderContext: { [key: string]: boolean } = {}
            const seenEvaluatorContext: { [key: string]: boolean } = {}
            for (let j = 0; i < context.count; j++) {
              const itemStr = context
                .get(j)
                .assertString(`${CONTEXT} item`).value
              const upperItemStr = itemStr.toUpperCase()
              if (seenReaderContext[upperItemStr]) {
                throw new Error(`Duplicate context item '${itemStr}'`)
              }
              seenReaderContext[upperItemStr] = true
              this.readerContext.push(itemStr)

              // Remove min/max parameter info
              const paramIndex = itemStr.indexOf("(")
              const modifiedItemStr =
                paramIndex > 0
                  ? itemStr.substr(0, paramIndex + 1) + ")"
                  : itemStr
              const upperModifiedItemStr = modifiedItemStr.toUpperCase()
              if (seenEvaluatorContext[upperModifiedItemStr]) {
                throw new Error(`Duplicate context item '${modifiedItemStr}'`)
              }
              seenEvaluatorContext[upperModifiedItemStr] = true
              this.evaluatorContext.push(modifiedItemStr)
            }

            break
          }
          case DESCRIPTION: {
            definition.remove(i)
            break
          }
          default: {
            i++
            break
          }
        }
      }
    }
  }

  public abstract get definitionType(): DefinitionType

  public abstract validate(schema: TemplateSchema, name: string): void
}

export abstract class ScalarDefinition extends Definition {
  public constructor(definition?: MappingToken) {
    super(definition)
  }

  public abstract isMatch(literal: LiteralToken): boolean
}

export class NullDefinition extends ScalarDefinition {
  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case NULL: {
            const mapping = definitionPair.value.assertMapping(
              `${DEFINITION} ${NULL}`
            )
            for (let j = 0; j < mapping.count; j++) {
              const mappingPair = mapping.get(j)
              const mappingKey = mappingPair.key.assertString(
                `${DEFINITION} ${NULL} key`
              )
              switch (mappingKey.value) {
                default:
                  mappingKey.assertUnexpectedValue(`${DEFINITION} ${NULL} key`) // throws
                  break
              }
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.Null
  }

  public override isMatch(literal: LiteralToken): boolean {
    return literal.templateTokenType === NULL_TYPE
  }

  public override validate(schema: TemplateSchema, name: string): void {}
}

export class BooleanDefinition extends ScalarDefinition {
  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case BOOLEAN: {
            const mapping = definitionPair.value.assertMapping(
              `${DEFINITION} ${BOOLEAN}`
            )
            for (let j = 0; j < mapping.count; j++) {
              const mappingPair = mapping.get(j)
              const mappingKey = mappingPair.key.assertString(
                `${DEFINITION} ${BOOLEAN} key`
              )
              switch (mappingKey.value) {
                default:
                  mappingKey.assertUnexpectedValue(
                    `${DEFINITION} ${BOOLEAN} key`
                  ) // throws
                  break
              }
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.Boolean
  }

  public override isMatch(literal: LiteralToken): boolean {
    return literal.templateTokenType === BOOLEAN_TYPE
  }

  public override validate(schema: TemplateSchema, name: string): void {}
}

export class NumberDefinition extends ScalarDefinition {
  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case NUMBER: {
            const mapping = definitionPair.value.assertMapping(
              `${DEFINITION} ${NUMBER}`
            )
            for (let j = 0; j < mapping.count; j++) {
              const mappingPair = mapping.get(j)
              const mappingKey = mappingPair.key.assertString(
                `${DEFINITION} ${NUMBER} key`
              )
              switch (mappingKey.value) {
                default:
                  mappingKey.assertUnexpectedValue(
                    `${DEFINITION} ${NUMBER} key`
                  ) // throws
                  break
              }
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.Number
  }

  public override isMatch(literal: LiteralToken): boolean {
    return literal.templateTokenType === NUMBER_TYPE
  }

  public override validate(schema: TemplateSchema, name: string): void {}
}

export class StringDefinition extends ScalarDefinition {
  public constant = ""
  public ignoreCase = false
  public requireNonEmpty = false

  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case STRING: {
            const mapping = definitionPair.value.assertMapping(
              `${DEFINITION} ${STRING}`
            )
            for (let j = 0; j < mapping.count; j++) {
              const mappingPair = mapping.get(j)
              const mappingKey = mappingPair.key.assertString(
                `${DEFINITION} ${STRING} key`
              )
              switch (mappingKey.value) {
                case CONSTANT: {
                  const constantStringToken = mappingPair.value.assertString(
                    `${DEFINITION} ${STRING} ${CONSTANT}`
                  )
                  this.constant = constantStringToken.value
                  break
                }
                case IGNORE_CASE: {
                  const ignoreCaseBooleanToken =
                    mappingPair.value.assertBoolean(
                      `${DEFINITION} ${STRING} ${IGNORE_CASE}`
                    )
                  this.ignoreCase = ignoreCaseBooleanToken.value
                  break
                }
                case REQUIRE_NON_EMPTY: {
                  const requireNonEmptyBooleanToken =
                    mappingPair.value.assertBoolean(
                      `${DEFINITION} ${STRING} ${REQUIRE_NON_EMPTY}`
                    )
                  this.requireNonEmpty = requireNonEmptyBooleanToken.value
                  break
                }
                default:
                  mappingKey.assertUnexpectedValue(
                    `${DEFINITION} ${STRING} key`
                  ) // throws
                  break
              }
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.String
  }

  public override isMatch(literal: LiteralToken): boolean {
    if (literal.templateTokenType === STRING_TYPE) {
      const value = (literal as StringToken).value
      if (this.constant) {
        return this.ignoreCase
          ? this.constant.toUpperCase() === value.toUpperCase()
          : this.constant === value
      } else if (this.requireNonEmpty) {
        return !!value
      } else {
        return true
      }
    }

    return false
  }

  public override validate(schema: TemplateSchema, name: string): void {
    if (this.constant && this.requireNonEmpty) {
      throw new Error(
        `Properties '${CONSTANT}' and '${REQUIRE_NON_EMPTY}' cannot both be set`
      )
    }
  }
}

export class SequenceDefinition extends Definition {
  public itemType = ""

  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case SEQUENCE: {
            const mapping = definitionPair.value.assertMapping(
              `${DEFINITION} ${SEQUENCE}`
            )
            for (let j = 0; j < mapping.count; j++) {
              const mappingPair = mapping.get(j)
              const mappingKey = mappingPair.key.assertString(
                `${DEFINITION} ${SEQUENCE} key`
              )
              switch (mappingKey.value) {
                case ITEM_TYPE: {
                  const itemType = mappingPair.value.assertString(
                    `${DEFINITION} ${SEQUENCE} ${ITEM_TYPE}`
                  )
                  this.itemType = itemType.value
                  break
                }
                default:
                  mappingKey.assertUnexpectedValue(
                    `${DEFINITION} ${SEQUENCE} key`
                  ) // throws
                  break
              }
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.Sequence
  }

  public override validate(schema: TemplateSchema, name: string): void {
    if (!this.itemType) {
      throw new Error(`'${name}' does not defined '${ITEM_TYPE}'`)
    }

    // Lookup item type
    schema.getDefinition(this.itemType)
  }
}

export class MappingDefinition extends Definition {
  public readonly properties: { [key: string]: PropertyValue } = {}
  public looseKeyType = ""
  public looseValueType = ""

  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case MAPPING: {
            const mapping = definitionPair.value.assertMapping(
              `${DEFINITION} ${MAPPING}`
            )
            for (let j = 0; j < mapping.count; j++) {
              const mappingPair = mapping.get(j)
              const mappingKey = mappingPair.key.assertString(
                `${DEFINITION} ${MAPPING} key`
              )
              switch (mappingKey.value) {
                case PROPERTIES: {
                  const properties = mappingPair.value.assertMapping(
                    `${DEFINITION} ${MAPPING} ${PROPERTIES}`
                  )
                  for (let k = 0; k < properties.count; k++) {
                    const propertiesPair = properties.get(k)
                    const propertyName = propertiesPair.key.assertString(
                      `${DEFINITION} ${MAPPING} ${PROPERTIES} key`
                    )
                    this.properties[propertyName.value] = new PropertyValue(
                      propertiesPair.value
                    )
                  }
                  break
                }
                case LOOSE_KEY_TYPE: {
                  const looseKeyType = mappingPair.value.assertString(
                    `${DEFINITION} ${MAPPING} ${LOOSE_KEY_TYPE}`
                  )
                  this.looseKeyType = looseKeyType.value
                  break
                }
                case LOOSE_VALUE_TYPE: {
                  const looseValueType = mappingPair.value.assertString(
                    `${DEFINITION} ${MAPPING} ${LOOSE_VALUE_TYPE}`
                  )
                  this.looseValueType = looseValueType.value
                  break
                }
                default:
                  mappingKey.assertUnexpectedValue(
                    `${DEFINITION} ${MAPPING} key`
                  ) // throws
                  break
              }
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.Mapping
  }

  public override validate(schema: TemplateSchema, name: string): void {
    // Lookup loose key type
    if (this.looseKeyType) {
      schema.getDefinition(this.looseKeyType)

      // Lookup loose value type
      if (this.looseValueType) {
        schema.getDefinition(this.looseValueType)
      } else {
        throw new Error(
          `Property '${LOOSE_KEY_TYPE}' is defined but '${LOOSE_VALUE_TYPE}' is not defined on '${name}'`
        )
      }
    }
    // Otherwise validate loose value type not be defined
    else if (this.looseValueType) {
      throw new Error(
        `Property '${LOOSE_VALUE_TYPE}' is defined but '${LOOSE_KEY_TYPE}' is not defined on '${name}'`
      )
    }

    // Lookup each property
    for (const propertyName of Object.keys(this.properties)) {
      const propertyValue = this.properties[propertyName]
      if (!propertyValue.type) {
        throw new Error(
          `Type not specified for the property '${propertyName}' on '${name}'`
        )
      }

      schema.getDefinition(propertyValue.type)
    }
  }
}

export class PropertyValue {
  public readonly type: string = ""
  public readonly required: boolean = false

  public constructor(token: TemplateToken) {
    if (token.templateTokenType === STRING_TYPE) {
      this.type = (token as StringToken).value
    } else {
      const mapping = token.assertMapping(MAPPING_PROPERTY_VALUE)
      for (let i = 0; i < mapping.count; i++) {
        const mappingPair = mapping.get(i)
        const mappingKey = mappingPair.key.assertString(
          `${MAPPING_PROPERTY_VALUE} key`
        )
        switch (mappingKey.value) {
          case TYPE:
            this.type = mappingPair.value.assertString(
              `${MAPPING_PROPERTY_VALUE} ${TYPE}`
            ).value
            break
          case REQUIRED:
            this.required = mappingPair.value.assertBoolean(
              `${MAPPING_PROPERTY_VALUE} ${REQUIRED}`
            ).value
            break
          default:
            mappingKey.assertUnexpectedValue(`${MAPPING_PROPERTY_VALUE} key`) // throws
        }
      }
    }
  }
}

/**
 * Must resolve to exactly one of the referenced definitions
 */
export class OneOfDefinition extends Definition {
  public readonly oneOf: string[] = []

  public constructor(definition?: MappingToken) {
    super(definition)
    if (definition) {
      for (let i = 0; i < definition.count; i++) {
        const definitionPair = definition.get(i)
        const definitionKey = definitionPair.key.assertString(
          `${DEFINITION} key`
        )
        switch (definitionKey.value) {
          case ONE_OF: {
            const oneOf = definitionPair.value.assertSequence(
              `${DEFINITION} ${ONE_OF}`
            )
            for (let j = 0; j < oneOf.count; j++) {
              const oneOfItem = oneOf
                .get(j)
                .assertString(`${DEFINITION} ${ONE_OF} item`)
              this.oneOf.push(oneOfItem.value)
            }
            break
          }
          default:
            definitionKey.assertUnexpectedValue(`${DEFINITION} key`) // throws
            break
        }
      }
    }
  }

  public override get definitionType(): DefinitionType {
    return DefinitionType.OneOf
  }

  public override validate(schema: TemplateSchema, name: string): void {
    if (this.oneOf.length === 0) {
      throw new Error(`'${name}' does not contain any references`)
    }

    let foundLooseKeyType = false
    const mappingDefinitions: MappingDefinition[] = []
    let sequenceDefinition: SequenceDefinition | undefined
    let nullDefinition: NullDefinition | undefined
    let booleanDefinition: BooleanDefinition | undefined
    let numberDefinition: NumberDefinition | undefined
    const stringDefinitions: StringDefinition[] = []
    const seenNestedTypes: { [key: string]: boolean } = {}

    for (const nestedType of this.oneOf) {
      if (seenNestedTypes[nestedType]) {
        throw new Error(
          `'${name}' contains duplicate nested type '${nestedType}'`
        )
      }
      seenNestedTypes[nestedType] = true

      const nestedDefinition = schema.getDefinition(nestedType)

      if (nestedDefinition.readerContext.length > 0) {
        throw new Error(
          `'${name}' is a one-of definition and references another definition that defines context. This is currently not supported.`
        )
      }

      switch (nestedDefinition.definitionType) {
        case DefinitionType.Mapping: {
          const mappingDefinition = nestedDefinition as MappingDefinition
          mappingDefinitions.push(mappingDefinition)
          if (mappingDefinition.looseKeyType) {
            foundLooseKeyType = true
          }
          break
        }
        case DefinitionType.Sequence: {
          // Multiple sequence definitions not allowed
          if (sequenceDefinition) {
            throw new Error(
              `'${name}' refers to more than one definition of type '${SEQUENCE}'`
            )
          }
          sequenceDefinition = nestedDefinition as SequenceDefinition
          break
        }
        case DefinitionType.Null: {
          // Multiple null definitions not allowed
          if (nullDefinition) {
            throw new Error(
              `'${name}' refers to more than one definition of type '${NULL}'`
            )
          }
          nullDefinition = nestedDefinition as NullDefinition
          break
        }
        case DefinitionType.Boolean: {
          // Multiple boolean definitions not allowed
          if (booleanDefinition) {
            throw new Error(
              `'${name}' refers to more than one definition of type '${BOOLEAN}'`
            )
          }
          booleanDefinition = nestedDefinition as BooleanDefinition
          break
        }
        case DefinitionType.Number: {
          // Multiple number definitions not allowed
          if (numberDefinition) {
            throw new Error(
              `'${name}' refers to more than one definition of type '${NUMBER}'`
            )
          }
          numberDefinition = nestedDefinition as NumberDefinition
          break
        }
        case DefinitionType.String: {
          const stringDefinition = nestedDefinition as StringDefinition

          // Multiple string definitions
          if (
            stringDefinitions.length > 0 &&
            (!stringDefinitions[0].constant || !stringDefinition.constant)
          ) {
            throw new Error(
              `'${name}' refers to more than one '${SCALAR}', but some do not set '${CONSTANT}'`
            )
          }

          stringDefinitions.push(stringDefinition)
          break
        }
        default:
          throw new Error(
            `'${name}' refers to a definition with type '${nestedDefinition.definitionType}'`
          )
      }
    }

    if (mappingDefinitions.length > 1) {
      if (foundLooseKeyType) {
        throw new Error(
          `'${name}' refers to two mappings and at least one sets '${LOOSE_KEY_TYPE}'. This is not currently supported.`
        )
      }

      const seenProperties: { [key: string]: PropertyValue } = {}
      for (const mappingDefinition of mappingDefinitions) {
        for (const propertyName of Object.keys(mappingDefinition.properties)) {
          const newPropertyValue = mappingDefinition.properties[propertyName]

          // Already seen
          const existingPropertyValue: PropertyValue | undefined =
            seenProperties[propertyName]
          if (existingPropertyValue) {
            // Types match
            if (existingPropertyValue.type === newPropertyValue.type) {
              continue
            }

            // Collision
            throw new Error(
              `'${name}' contains two mappings with the same property, but each refers to a different type. All matching properties must refer to the same type.`
            )
          }
          // New
          else {
            seenProperties[propertyName] = newPropertyValue
          }
        }
      }
    }
  }
}
