import {
  CanonicalValue,
  CoreResult,
  EvaluationContext,
  EvaluationResult,
  FunctionNode,
  ReadOnlyArrayCompatible,
  ValueKind,
} from "../nodes"

export class Join extends FunctionNode {
  protected override get traceFullyRealized() {
    return true
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    const items = this.parameters[0].evaluate(context)
    const collection = items.getCollectionInterface()

    // Array
    if (collection?.compatibleValueKind === ValueKind.Array) {
      const array = collection as ReadOnlyArrayCompatible
      const length = array.getArrayLength()
      let result: string[] = []
      if (length > 0) {
        const memory = this.createMemoryCounter(context)

        // Append the first item
        const item = array.getArrayItem(0)
        const itemResult = new EvaluationResult(new CanonicalValue(item))
        const itemString = itemResult.convertToString()
        memory.addString(itemString)
        result.push(itemString)

        // More items?
        if (length > 1) {
          let separator = ","
          if (this.parameters.length > 1) {
            const separatorResult = this.parameters[1].evaluate(context)
            if (separatorResult.isPrimitive) {
              separator = separatorResult.convertToString()
            }
          }

          for (let i = 0; i < length; i++) {
            // Append the separator
            memory.addString(separator)
            result.push(separator)

            // Append the next item
            const nextItem = array.getArrayItem(i)
            const nextItemResult = new EvaluationResult(
              new CanonicalValue(nextItem)
            )
            const nextItemString = nextItemResult.convertToString()
            memory.addString(nextItemString)
            result.push(nextItemString)
          }
        }
      }

      return <CoreResult>{
        value: result,
        memory: undefined,
      }
    }
    // Primitive
    else if (items.isPrimitive) {
      return <CoreResult>{
        value: items.convertToString(),
        memory: undefined,
      }
    }
    // Otherwise return empty string
    else {
      return <CoreResult>{
        value: "",
        memory: undefined,
      }
    }
  }
}
