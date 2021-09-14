import * as expressionUtility from "../expression-utility"
import {
  ContainerNode,
  AbstractExpressionNode,
  LiteralNode,
  NodeType,
  EvaluationResult,
  EvaluationContext,
  CoreResult,
  ReadOnlyObjectCompatible,
  ReadOnlyArrayCompatible,
  ResultMemory,
  CanonicalValue,
  ValueKind,
} from "../nodes"

export class Index extends ContainerNode {
  protected override get traceFullyRealized(): boolean {
    return true
  }

  public override convertToExpression(): string {
    // Dot format, for example: github.sha
    if (this.parameters[1].nodeType == NodeType.Literal) {
      const literal = this.parameters[1] as LiteralNode
      if (
        literal.kind === ValueKind.String &&
        expressionUtility.testLegalKeyword(literal.value as string)
      ) {
        return `${this.parameters[0].convertToExpression()}.${literal.value}`
      }
    }

    // Index format, for example: commits[0]
    return `${this.parameters[0].convertToExpression()}[${this.parameters[1].convertToExpression()}]`
  }

  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    // Check if the result was stored
    const result = context.getTraceResult(this)
    if (result) {
      return result
    }

    return `${this.parameters[0].convertToRealizedExpression(
      context
    )}[${this.parameters[1].convertToRealizedExpression(context)}]`
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    const left = this.parameters[0].evaluate(context)
    const collection = left.getCollectionInterface()

    // Not a collection
    if (!collection) {
      return <CoreResult>{
        value:
          this.parameters[1].nodeType === NodeType.Wildcard
            ? new FilteredArray()
            : undefined,
        memory: undefined,
      }
    }
    // Filtered array
    else if (
      collection.compatibleValueKind === ValueKind.Array &&
      (collection as FilteredArray | undefined)?.isFilteredArray === true
    ) {
      return this.handleFilteredArray(context, collection as FilteredArray)
    }
    // Array
    else if (collection.compatibleValueKind === ValueKind.Array) {
      return this.handleArray(context, collection as ReadOnlyArrayCompatible)
    }
    // Object
    else if (collection.compatibleValueKind === ValueKind.Object) {
      return this.handleObject(context, collection as ReadOnlyObjectCompatible)
    }

    return <CoreResult>{
      value: undefined,
      memory: undefined,
    }
  }

  private handleFilteredArray(
    context: EvaluationContext,
    filteredArray: FilteredArray
  ): CoreResult {
    const result = new FilteredArray()
    const counter = this.createMemoryCounter(context)

    const indexHelper = new IndexHelper(context, this.parameters[1])

    // Apply the index to each nested object or array
    const length = filteredArray.getArrayLength()
    for (let i = 0; i < length; i++) {
      const item = filteredArray.getArrayItem(i)

      // Leverage the expression sdK to traverse the object
      const itemResult = new EvaluationResult(new CanonicalValue(item))
      const collection = itemResult.getCollectionInterface()

      // Nested object
      if (collection?.compatibleValueKind === ValueKind.Object) {
        const nestedObject = collection as ReadOnlyObjectCompatible

        // Wildcard
        if (indexHelper.isWildcard) {
          for (const nestedKey of nestedObject.getObjectKeys()) {
            const nestedValue = nestedObject.getObjectValue(nestedKey)
            result.add(nestedValue)
            counter.addPointer()
          }
        }
        // String
        else if (indexHelper.hasStringIndex) {
          if (nestedObject.hasObjectKey(indexHelper.stringIndex!)) {
            const nestedValue = nestedObject.getObjectValue(
              indexHelper.stringIndex!
            )
            result.add(nestedValue)
            counter.addPointer()
          }
        }
      }
      // Nested array
      else if (collection?.compatibleValueKind === ValueKind.Array) {
        const nestedArray = collection as ReadOnlyArrayCompatible

        // Wildcard
        if (indexHelper.isWildcard) {
          const nestedLength = nestedArray.getArrayLength()
          for (let nestedIndex = 0; nestedIndex < nestedLength; nestedIndex++) {
            const nestedItem = nestedArray.getArrayItem(nestedIndex)
            result.add(nestedItem)
            counter.addPointer()
          }
        }
        // String
        else if (
          indexHelper.hasIntegerIndex &&
          indexHelper.integerIndex! < nestedArray.getArrayLength()
        ) {
          result.add(nestedArray.getArrayItem(indexHelper.integerIndex!))
          counter.addPointer()
        }
      }
    }

    return <CoreResult>{
      value: result,
      memory: new ResultMemory(counter.currentBytes),
    }
  }

  private handleObject(
    context: EvaluationContext,
    object: ReadOnlyObjectCompatible
  ): CoreResult {
    const indexHelper = new IndexHelper(context, this.parameters[1])

    // Wildcard
    if (indexHelper.isWildcard) {
      const filteredArray = new FilteredArray()
      const counter = this.createMemoryCounter(context)
      counter.addMinObjectSize()

      for (const key of object.getObjectKeys()) {
        filteredArray.add(object.getObjectValue(key))
        counter.addPointer()
      }

      return <CoreResult>{
        value: filteredArray,
        memory: new ResultMemory(counter.currentBytes),
      }
    }
    // String
    else if (
      indexHelper.hasStringIndex &&
      object.hasObjectKey(indexHelper.stringIndex!)
    ) {
      return <CoreResult>{
        value: object.getObjectValue(indexHelper.stringIndex!),
        memory: undefined,
      }
    }

    return <CoreResult>{
      value: undefined,
      memory: undefined,
    }
  }

  public handleArray(
    context: EvaluationContext,
    array: ReadOnlyArrayCompatible
  ): CoreResult {
    const indexHelper = new IndexHelper(context, this.parameters[1])

    // Wildcard
    if (indexHelper.isWildcard) {
      const filtered = new FilteredArray()
      const counter = this.createMemoryCounter(context)
      counter.addMinObjectSize()

      const length = array.getArrayLength()
      for (let i = 0; i < length; i++) {
        filtered.add(array.getArrayItem(i))
        counter.addPointer()
      }

      return <CoreResult>{
        value: filtered,
        memory: new ResultMemory(counter.currentBytes),
      }
    }
    // Integer
    else if (
      indexHelper.hasIntegerIndex &&
      indexHelper.integerIndex! < array.getArrayLength()
    ) {
      return <CoreResult>{
        value: array.getArrayItem(indexHelper.integerIndex!),
        memory: undefined,
      }
    }

    return <CoreResult>{
      value: undefined,
      memory: undefined,
    }
  }
}

class FilteredArray implements ReadOnlyArrayCompatible {
  private readonly _list: any[] = []
  public compatibleValueKind = ValueKind.Array
  public isFilteredArray = true

  public add(item: any): void {
    this._list.push(item)
  }

  public getArrayLength(): number {
    return this._list.length
  }

  public getArrayItem(index: number) {
    return this._list[index]
  }
}

class IndexHelper {
  private readonly _parameter: AbstractExpressionNode
  private readonly _result: EvaluationResult
  private _integerIndex: number | undefined | null
  private _stringIndex: string | undefined | null

  public constructor(
    context: EvaluationContext,
    parameter: AbstractExpressionNode
  ) {
    this._parameter = parameter
    this._result = parameter.evaluate(context)
  }

  public get isWildcard(): boolean {
    return this._parameter.nodeType === NodeType.Wildcard
  }

  public get hasIntegerIndex(): boolean {
    return this.integerIndex !== null
  }

  public get hasStringIndex(): boolean {
    return this.stringIndex !== null
  }

  public get integerIndex(): number | null {
    if (this._integerIndex === undefined) {
      let doubleIndex = this._result.convertToNumber()
      if (isNaN(doubleIndex) || doubleIndex < 0) {
        this._integerIndex = null
      }

      doubleIndex = Math.floor(doubleIndex)
      if (doubleIndex > 2147483647) {
        // max integer in most languages
        this._integerIndex = null
      }

      this._integerIndex = doubleIndex
    }

    return this._integerIndex
  }

  public get stringIndex(): string | null {
    if (this._stringIndex === undefined) {
      this._stringIndex = this._result.isPrimitive
        ? this._result.convertToString()
        : null
    }

    return this._stringIndex
  }
}
