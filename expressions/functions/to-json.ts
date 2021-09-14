import * as expressionUtility from "../expression-utility"
import {
  CanonicalValue,
  CoreResult,
  EvaluationContext,
  EvaluationResult,
  FunctionNode,
  MemoryCounter,
  ReadOnlyArrayCompatible,
  ReadOnlyObjectCompatible,
  ValueKind,
} from "../nodes"

export class ToJson extends FunctionNode {
  public override evaluateCore(context: EvaluationContext): CoreResult {
    const json: string[] = []
    const memory = this.createMemoryCounter(context)
    let current: EvaluationResult | undefined =
      this.parameters[0].evaluate(context)
    const ancestors: ICollectionEnumerator[] = []

    do {
      // Descend as much as possible
      while (true) {
        // Collection
        const collection = current!.getCollectionInterface()
        if (collection) {
          // Array
          if (collection.compatibleValueKind === ValueKind.Array) {
            const array = collection as ReadOnlyArrayCompatible
            if (array.getArrayLength() > 0) {
              // Write array start
              ToJson.writeArrayStart(json, memory, ancestors)

              // Move to first item
              const enumerator: ArrayEnumerator = new ArrayEnumerator(
                context,
                current!
              )
              enumerator.moveNext()
              ancestors.push(enumerator)
              current = enumerator.current
            } else {
              // Write empty array
              ToJson.writeEmptyArray(json, memory, ancestors)
              break
            }
          }
          // Object
          else if (collection.compatibleValueKind === ValueKind.Object) {
            const object = collection as ReadOnlyObjectCompatible
            if (object.getObjectKeyCount() > 0) {
              // Write object start
              ToJson.writeObjectStart(json, memory, ancestors)

              // Move to first pair
              const enumerator = new ObjectEnumerator(context, current!)
              enumerator.moveNext()
              ancestors.push(enumerator)

              // Write key
              ToJson.writeObjectKey(
                json,
                memory,
                enumerator.current!.key,
                ancestors
              )

              // Move to value
              current = enumerator.current!.value
            } else {
              // Write empty object
              ToJson.writeEmptyObject(json, memory, ancestors)
              break
            }
          } else {
            throw new Error(
              `Unexpected collection kind '${collection.compatibleValueKind}'`
            )
          }
        }
        // Primitive
        else {
          // Write value
          ToJson.writeValue(json, memory, current!, ancestors)
          break
        }
      }

      // Next sibling or ancestor sibling
      do {
        if (ancestors.length > 0) {
          const parent = ancestors[ancestors.length - 1]

          // Parent array
          if (parent.kind === ValueKind.Array) {
            const arrayEnumerator = parent as ArrayEnumerator

            // Move to next item
            if (arrayEnumerator.moveNext()) {
              current = arrayEnumerator.current
              break
            }
            // Move to parent
            else {
              ancestors.pop()
              current = arrayEnumerator.array

              // Write array end
              ToJson.writeArrayEnd(json, memory, ancestors)
            }
          }
          // Parent object
          else if (parent.kind === ValueKind.Object) {
            const objectEnumerator = parent as ObjectEnumerator

            // Move to next pair
            if (objectEnumerator.moveNext()) {
              // Write key
              ToJson.writeObjectKey(
                json,
                memory,
                objectEnumerator.current!.key,
                ancestors
              )

              // Move to value
              current = objectEnumerator.current!.value

              break
            }
            // Move to parent
            else {
              ancestors.pop()
              current = objectEnumerator.object

              // Write object end
              ToJson.writeObjectEnd(json, memory, ancestors)
            }
          } else {
            throw new Error(
              `Unexpected parent collection kind '${parent.kind}'`
            )
          }
        } else {
          current = undefined
        }
      } while (current)
    } while (current)

    return <CoreResult>{
      value: json.join(""),
      memory: undefined,
    }
  }

  private static writeArrayStart(
    json: string[],
    memory: MemoryCounter,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = ToJson.prefixValue("[", ancestors)
    memory.addString(string)
    json.push(string)
  }

  private static writeObjectStart(
    json: string[],
    memory: MemoryCounter,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = ToJson.prefixValue("{", ancestors)
    memory.addString(string)
    json.push(string)
  }

  private static writeArrayEnd(
    json: string[],
    memory: MemoryCounter,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = `\n${expressionUtility.indent(ancestors.length, "  ")}]`
    memory.addString(string)
    json.push(string)
  }

  private static writeObjectEnd(
    json: string[],
    memory: MemoryCounter,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = `\n${expressionUtility.indent(ancestors.length, "  ")}}`
    memory.addString(string)
    json.push(string)
  }

  private static writeEmptyArray(
    json: string[],
    memory: MemoryCounter,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = ToJson.prefixValue("[]", ancestors)
    memory.addString(string)
    json.push(string)
  }

  private static writeEmptyObject(
    json: string[],
    memory: MemoryCounter,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = ToJson.prefixValue("{}", ancestors)
    memory.addString(string)
    json.push(string)
  }

  private static writeObjectKey(
    json: string[],
    memory: MemoryCounter,
    key: EvaluationResult,
    ancestors: ICollectionEnumerator[]
  ): void {
    const string = ToJson.prefixValue(
      JSON.stringify(key.convertToString()),
      ancestors,
      true
    )
    memory.addString(string)
    json.push(string)
  }

  private static writeValue(
    json: string[],
    memory: MemoryCounter,
    value: EvaluationResult,
    ancestors: ICollectionEnumerator[]
  ): void {
    let string: string
    switch (value.kind) {
      case ValueKind.Null:
        string = "null"
        break
      case ValueKind.Boolean:
        string = value.value ? "true" : "false"
        break
      case ValueKind.Number:
        string = value.convertToString()
        break
      case ValueKind.String:
        string = JSON.stringify(value.value)
        break
      default:
        string = "{}" // The value is an object we don't know how to traverse
        break
    }

    string = ToJson.prefixValue(string, ancestors)
    memory.addString(string)
    json.push(string)
  }

  private static prefixValue(
    value: string,
    ancestors: ICollectionEnumerator[],
    isObjectKey: boolean = false
  ): string {
    const level = ancestors.length
    const parent = level > 0 ? ancestors[ancestors.length - 1] : undefined

    if (!isObjectKey && parent?.kind === ValueKind.Object) {
      return `: ${value}`
    } else if (level > 0) {
      return `${parent!.isFirst ? "" : ","}\n${expressionUtility.indent(
        level,
        "  "
      )}${value}`
    } else {
      return value
    }
  }
}

interface ICollectionEnumerator {
  get kind(): ValueKind

  get isFirst(): boolean

  moveNext(): boolean
}

class ArrayEnumerator implements ICollectionEnumerator {
  private readonly _context: EvaluationContext
  private _index = -1
  public readonly array: EvaluationResult
  public current: EvaluationResult | undefined

  public constructor(context: EvaluationContext, array: EvaluationResult) {
    this._context = context
    this.array = array
  }

  public get kind() {
    return ValueKind.Array
  }

  public get isFirst() {
    return this._index === 0
  }

  public moveNext(): boolean {
    const array = this.array.value as ReadOnlyArrayCompatible
    if (this._index + 1 < array.getArrayLength()) {
      this._index++
      this.current = new EvaluationResult(
        new CanonicalValue(array.getArrayItem(this._index))
      )
      return true
    } else {
      this.current = undefined
      return false
    }
  }
}

class ObjectEnumerator implements ICollectionEnumerator {
  private readonly _context: EvaluationContext
  private readonly _keys: string[]
  private _index = -1
  public readonly object: EvaluationResult
  public current: KeyValuePair | undefined

  public constructor(context: EvaluationContext, object: EvaluationResult) {
    this._context = context
    this.object = object
    this._keys = (object.value as ReadOnlyObjectCompatible).getObjectKeys()
  }

  public get kind() {
    return ValueKind.Object
  }

  public get isFirst() {
    return this._index === 0
  }

  public moveNext(): boolean {
    if (this._index + 1 < this._keys.length) {
      this._index++
      const object = this.object.value as ReadOnlyObjectCompatible
      const keyString = this._keys[this._index]
      const key = new EvaluationResult(new CanonicalValue(keyString))
      const value = new EvaluationResult(
        new CanonicalValue(object.getObjectValue(keyString))
      )
      this.current = <KeyValuePair>{
        key,
        value,
      }
      return true
    } else {
      this.current = undefined
      return false
    }
  }
}

interface KeyValuePair {
  key: EvaluationResult
  value: EvaluationResult
}
