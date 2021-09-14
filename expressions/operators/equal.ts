import { ContainerNode, CoreResult, EvaluationContext } from "../nodes"

export class Equal extends ContainerNode {
  protected override get traceFullyRealized(): boolean {
    return false
  }

  public override convertToExpression(): string {
    return `(${this.parameters[0].convertToExpression()} == ${this.parameters[1].convertToExpression()})`
  }

  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    // Check if the result was stored
    const result = context.getTraceResult(this)
    if (result) {
      return result
    }

    return `(${this.parameters[0].convertToRealizedExpression(
      context
    )} == ${this.parameters[1].convertToRealizedExpression(context)})`
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    const left = this.parameters[0].evaluate(context)
    const right = this.parameters[1].evaluate(context)
    return <CoreResult>{
      value: left.abstractEqual(right),
      memory: undefined,
    }
  }
}
