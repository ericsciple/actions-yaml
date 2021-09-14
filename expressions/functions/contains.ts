import {
  CanonicalValue,
  CoreResult,
  EvaluationContext,
  EvaluationResult,
  FunctionNode,
  ReadOnlyArrayCompatible,
  ValueKind,
} from "../nodes"

export class Contains extends FunctionNode {
  protected override get traceFullyRealized(): boolean {
    return false
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    let found = false
    const left = this.parameters[0].evaluate(context)
    if (left.isPrimitive) {
      const leftString = left.convertToString()

      const right = this.parameters[1].evaluate(context)
      if (right.isPrimitive) {
        const rightString = right.convertToString()
        found = leftString.toUpperCase().indexOf(rightString.toUpperCase()) >= 0
      }
    } else {
      const collection = left.getCollectionInterface()
      if (collection?.compatibleValueKind === ValueKind.Array) {
        const array = collection as ReadOnlyArrayCompatible
        const length = array.getArrayLength()
        if (length > 0) {
          const right = this.parameters[1].evaluate(context)
          for (let i = 0; i < length; i++) {
            const itemResult = new EvaluationResult(
              new CanonicalValue(array.getArrayItem(i))
            )
            if (right.abstractEqual(itemResult)) {
              found = true
              break
            }
          }
        }
      }
    }

    return <CoreResult>{
      value: found,
      memory: undefined,
    }
  }
}
