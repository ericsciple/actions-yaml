import { ContainerNode, CoreResult, EvaluationContext } from "../nodes"

export class Not extends ContainerNode {
  protected override get traceFullyRealized(): boolean {
    return false
  }

  public override convertToExpression(): string {
    return `!${this.parameters[0].convertToExpression()}`
  }

  public override convertToRealizedExpression(
    context: EvaluationContext
  ): string {
    // Check if the result was stored
    const result = context.getTraceResult(this)
    if (result) {
      return result
    }

    return `!${this.parameters[0].convertToRealizedExpression(context)}`
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    const result = this.parameters[0].evaluate(context)
    return <CoreResult>{
      value: result.isFalsy,
      memory: undefined,
    }
  }
}
