import {
  BooleanCompatible,
  NumberCompatible,
  ReadOnlyArrayCompatible,
  ReadOnlyObjectCompatible,
  StringCompatible,
  ValueKind,
} from "./nodes"

export const STRING_TYPE = 0
export const ARRAY_TYPE = 1
export const DICTIONARY_TYPE = 2
export const BOOLEAN_TYPE = 3
export const NUMBER_TYPE = 4
export const CASE_SENSITIVE_DICTIONARY_TYPE = 5

////////////////////////////////////////////////////////////////////////////////
// Context data classes
////////////////////////////////////////////////////////////////////////////////

export abstract class ContextData {
  private readonly t: number | undefined

  protected constructor(type: number) {
    this.t = type
  }

  public get type(): number {
    return this.t ?? 0
  }

  public abstract clone(): ContextData

  /**
   * Returns all context data object (depth first)
   * @param value The object to travese
   * @param omitKeys Whether to omit dictionary keys
   */
  public static *traverse(
    value: ContextData | null,
    omitKeys?: boolean
  ): Generator<ContextData | null, void> {
    yield value
    switch (value?.type) {
      case ARRAY_TYPE:
      case DICTIONARY_TYPE:
      case CASE_SENSITIVE_DICTIONARY_TYPE: {
        let state: TraversalState | undefined = new TraversalState(
          undefined,
          value
        )
        while (state) {
          if (state.moveNext(omitKeys ?? false)) {
            value = state.current as ContextData | null
            yield value

            switch (value?.type) {
              case ARRAY_TYPE:
              case DICTIONARY_TYPE:
              case CASE_SENSITIVE_DICTIONARY_TYPE:
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

  /**
   * Converts to ContextData from serialized ContextData.
   */
  public static fromContextDataJSON(string: string): ContextData | null {
    return ContextData.fromDeserializedContextData(JSON.parse(string))
  }

  /**
   * Converts to ContextData from serialized ContextData that has already been JSON-parsed into regular JavaScript objects.
   */
  public static fromDeserializedContextData(object: any): ContextData | null {
    switch (typeof object) {
      case "boolean":
        return new BooleanContextData(object as boolean)
      case "number":
        return new NumberContextData(object as number)
      case "string":
        return new StringContextData(object as string)
      case "object": {
        if (object === null) {
          return null
        }

        const type: number = Object.prototype.hasOwnProperty.call(object, "t")
          ? (object.t as number)
          : STRING_TYPE

        switch (type) {
          case BOOLEAN_TYPE:
            return new BooleanContextData(object.b ?? false)
          case NUMBER_TYPE:
            return new NumberContextData(object.n ?? 0)
          case STRING_TYPE:
            return new StringContextData(object.s ?? "")
          case ARRAY_TYPE: {
            const array = new ArrayContextData()
            for (const item of object.a ?? []) {
              array.push(ContextData.fromDeserializedContextData(item))
            }
            return array
          }
          case DICTIONARY_TYPE:
          case CASE_SENSITIVE_DICTIONARY_TYPE: {
            const dictionary = new DictionaryContextData(
              type === CASE_SENSITIVE_DICTIONARY_TYPE
            )
            for (const pair of object.d ?? []) {
              const key = pair.k ?? ""
              const value = ContextData.fromDeserializedContextData(pair.v)
              dictionary.set(key, value)
            }
            return dictionary
          }
          default:
            throw new Error(
              `Unexpected context type '${type}' when converting deserialized context data to context data`
            )
        }
      }
      default:
        throw new Error(
          `Unexpected type '${typeof object}' when converting deserialized context data to context data`
        )
    }
  }

  /**
   * Convert plain JSON objects into ContextData. Supports boolean, number, string, array, object, null
   */
  public static fromJSON(string: string): ContextData | null {
    return ContextData.fromObject(JSON.parse(string))
  }

  /**
   * Convert plain JavaScript types into ContextData. Supports boolean, number, string, array, object, null, undefined.
   */
  public static fromObject(object: any): ContextData | null {
    return ContextData.fromObjectInternal(object, 1, 100)
  }

  /**
   * Convert to plain JavaScript types: boolean, number, string, array, object, null.
   */
  public static toObject(value: ContextData | null): any {
    switch (value?.type) {
      case null:
        return null
      case BOOLEAN_TYPE:
        return (value as BooleanContextData).value
      case NUMBER_TYPE:
        return (value as NumberContextData).value
      case STRING_TYPE:
        return (value as StringContextData).value
      case ARRAY_TYPE: {
        const array = value as ArrayContextData
        const result: any[] = []
        for (let i = 0; i < array.length; i++) {
          result.push(ContextData.toObject(array.get(i)))
        }
        return result
      }
      case DICTIONARY_TYPE:
      case CASE_SENSITIVE_DICTIONARY_TYPE: {
        const dictionary = value as DictionaryContextData
        const result: { [key: string]: any } = {}
        for (let i = 0; i < dictionary.keyCount; i++) {
          const pair = dictionary.getPair(i)
          result[pair.key] = ContextData.toObject(pair.value)
        }
        return result
      }
      default:
        throw new Error(
          `Unexpected type '${value?.type}' when converting context data to object`
        )
    }
  }

  private static fromObjectInternal(
    object: any,
    depth: number,
    maxDepth: number
  ): ContextData | null {
    if (depth > 100) {
      throw new Error(
        `Reached max depth '${maxDepth}' when converting object to context data`
      )
    }

    switch (typeof object) {
      case "boolean":
        return new BooleanContextData(object as boolean)
      case "number":
        return new NumberContextData(object as number)
      case "string":
        return new StringContextData(object as string)
      case "undefined":
        return null
      case "object":
        if (object === null) {
          return null
        } else if (Object.prototype.hasOwnProperty.call(object, "length")) {
          const array = new ArrayContextData()
          for (let i = 0; i < object.length; i++) {
            array.push(
              ContextData.fromObjectInternal(object[i], depth + 1, maxDepth)
            )
          }
          return array
        } else {
          const dictionary = new DictionaryContextData()
          for (const key of Object.keys(object)) {
            dictionary.set(
              key,
              ContextData.fromObjectInternal(object[key], depth + 1, maxDepth)
            )
          }
          return dictionary
        }
      default:
        throw new Error(
          `Unexpected type '${typeof object}' when converting object to context data`
        )
    }
  }
}

export class BooleanContextData
  extends ContextData
  implements BooleanCompatible
{
  private readonly b: boolean | undefined

  public constructor(boolean: boolean) {
    super(BOOLEAN_TYPE)
    if (boolean !== false) {
      this.b = boolean
    }
  }

  // Required for interface BooleanCompatible
  public get compatibleValueKind(): ValueKind {
    return ValueKind.Boolean
  }

  public get value(): boolean {
    return this.b ?? false
  }

  public override clone(): ContextData {
    return new BooleanContextData(this.value)
  }

  // Required for interface BooleanCompatible
  public getBoolean(): boolean {
    return this.value
  }
}

export class NumberContextData extends ContextData implements NumberCompatible {
  private readonly n: number | undefined

  public constructor(number: number) {
    super(NUMBER_TYPE)
    if (number !== 0) {
      this.n = number
    }
  }

  // Required for interface NumberCompatible
  public get compatibleValueKind(): ValueKind {
    return ValueKind.Number
  }

  public get value(): number {
    return this.n ?? 0
  }

  public override clone(): ContextData {
    return new NumberContextData(this.value)
  }

  // Required for interface NumberCompatible
  public getNumber(): number {
    return this.value
  }
}

export class StringContextData extends ContextData implements StringCompatible {
  private readonly s: string | undefined

  public constructor(string: string) {
    super(STRING_TYPE)
    if (string !== "") {
      this.s = string
    }
  }

  // Required for interface StringCompatible
  public get compatibleValueKind(): ValueKind {
    return ValueKind.String
  }

  public get value(): string {
    return this.s ?? ""
  }

  public override clone(): ContextData {
    return new StringContextData(this.value)
  }

  // Required for interface StringCompatible
  public getString(): string {
    return this.value
  }
}

export class ArrayContextData
  extends ContextData
  implements ReadOnlyArrayCompatible
{
  private readonly a: (ContextData | null)[] = []

  public constructor() {
    super(ARRAY_TYPE)
  }

  // Required for interface ReadOnlyArrayCompatible
  public get compatibleValueKind(): ValueKind {
    return ValueKind.Array
  }

  public get length(): number {
    return this.a.length
  }

  public push(item: ContextData | null): void {
    this.a.push(item)
  }

  public get(index: number): ContextData | null {
    return this.a[index] ?? null
  }

  public override clone(): ContextData {
    const result = new ArrayContextData()
    for (let i = 0; i < this.length; i++) {
      result.push(this.get(i))
    }
    return result
  }

  // Required for interface ReadOnlyArrayCompatible
  public getArrayLength(): number {
    return this.length
  }

  // Required for interface ReadOnlyArrayCompatible
  public getArrayItem(index: number): any {
    return this.get(index)
  }
}

export class DictionaryContextData
  extends ContextData
  implements ReadOnlyObjectCompatible
{
  private readonly d: KeyValuePair[] = []

  /**
   * Used to hide properties that should not be serialized
   */
  private readonly _getHiddenProperty: (
    propertyName: string,
    createDefaultValue: () => any
  ) => any

  public constructor(caseSensitive?: boolean) {
    super(caseSensitive ? CASE_SENSITIVE_DICTIONARY_TYPE : DICTIONARY_TYPE)

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
  }

  private get _indexLookup(): { [key: string]: number } {
    // Prevent index lookup from being serialized
    return this._getHiddenProperty("indexLookup", () => {
      return {}
    }) as { [key: string]: number }
  }

  public get keyCount(): number {
    return this.d.length
  }

  // Required for interface ReadOnlyObjectCompatible
  public get compatibleValueKind(): ValueKind {
    return ValueKind.Object
  }

  public get(key: string): ContextData | null {
    const lookupKey = this.getLookupKey(key)
    if (Object.prototype.hasOwnProperty.call(this._indexLookup, lookupKey)) {
      const index = this._indexLookup[lookupKey]
      return this.d[index].value
    }

    return null
  }

  public getPair(index: number): KeyValuePair {
    return this.d[index]
  }

  public set(key: string, value: ContextData | null): void {
    const lookupKey = this.getLookupKey(key)
    if (Object.prototype.hasOwnProperty.call(this._indexLookup, lookupKey)) {
      const index = this._indexLookup[lookupKey]
      const existingPair = this.d[index]
      this.d[index] = new KeyValuePair(existingPair.key, value)
    } else {
      this.d.push(new KeyValuePair(key, value))
      this._indexLookup[lookupKey] = this.d.length - 1
    }
  }

  // Required for interface ReadOnlyObjectCompatible
  public hasObjectKey(key: string): boolean {
    const lookupKey = this.getLookupKey(key)
    return Object.prototype.hasOwnProperty.call(this._indexLookup, lookupKey)
  }

  // Required for interface ReadOnlyObjectCompatible
  public getObjectKeys(): string[] {
    const result: string[] = []
    for (const pair of this.d) {
      result.push(pair.key)
    }
    return result
  }

  // Required for interface ReadOnlyObjectCompatible
  public getObjectKeyCount(): number {
    return this.d.length
  }

  // Required for interface ReadOnlyObjectCompatible
  public getObjectValue(key: string): any {
    return this.get(key)
  }

  public override clone(): ContextData {
    const result = new DictionaryContextData()
    for (const pair of this.d) {
      result.set(pair.key, pair.value)
    }
    return result
  }

  /**
   * Translates to upper if case-insensitive
   */
  private getLookupKey(key: string): string {
    return this.type === DICTIONARY_TYPE ? key.toUpperCase() : key
  }
}

export class KeyValuePair {
  private readonly k: string
  private readonly v: ContextData | null

  public get key(): string {
    return this.k
  }

  public get value(): ContextData | null {
    return this.v
  }

  public constructor(key: string, value: ContextData | null) {
    this.k = key
    this.v = value
  }
}

class TraversalState {
  private readonly _data: ContextData
  private index = -1
  private isKey = false
  public readonly parent: TraversalState | undefined
  public current: ContextData | null | undefined

  public constructor(parent: TraversalState | undefined, data: ContextData) {
    this.parent = parent
    this._data = data
  }

  public moveNext(omitKeys: boolean): boolean {
    switch (this._data.type) {
      case ARRAY_TYPE: {
        const array = this._data as ArrayContextData
        if (++this.index < array.length) {
          this.current = array.get(this.index)
          return true
        }
        this.current = undefined
        return false
      }

      case DICTIONARY_TYPE:
      case CASE_SENSITIVE_DICTIONARY_TYPE: {
        const object = this._data as DictionaryContextData

        // Already returned the key, now return the value
        if (this.isKey) {
          this.isKey = false
          this.current = object.getPair(this.index).value
          return true
        }

        // Move next
        if (++this.index < object.keyCount) {
          // Skip the key, return the value
          if (omitKeys) {
            this.isKey = false
            this.current = object.getPair(this.index).value
            return true
          }

          // Return the key
          this.isKey = true
          this.current = new StringContextData(object.getPair(this.index).key)
          return true
        }

        this.current = undefined
        return false
      }

      default:
        throw new Error(
          `Unexpected context data type '${this._data.type}' when traversing state`
        )
    }
  }
}
