import { CoreResult, EvaluationContext, FunctionNode } from "../nodes"

export class EndsWith extends FunctionNode {
  protected override get traceFullyRealized() {
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
        found = leftString.toUpperCase().endsWith(rightString.toUpperCase())
      }
    }

    return <CoreResult>{
      value: found,
      memory: undefined,
    }
  }
}
