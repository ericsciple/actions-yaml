import {
  ContainerNode,
  CoreResult,
  EvaluationContext,
  EvaluationResult,
} from "../nodes"

export class Or extends ContainerNode {
  public readonly isOrOperator = true

  protected override get traceFullyRealized(): boolean {
    return false
  }

  public override convertToExpression(): string {
    return `(${this.parameters
      .map((x) => x.convertToExpression())
      .join(" || ")})`
  }

  public override convertToRealizedExpression(context: EvaluationContext) {
    // Check if the result was stored
    const result = context.getTraceResult(this)
    if (result) {
      return result
    }

    return `(${this.parameters
      .map((x) => x.convertToRealizedExpression(context))
      .join(" || ")})`
  }

  public override evaluateCore(context: EvaluationContext): CoreResult {
    let result: EvaluationResult | undefined
    for (const parameter of this.parameters) {
      result = parameter.evaluate(context)
      if (result.isTruthy) {
        break
      }
    }

    return <CoreResult>{
      value: result?.value,
      memory: undefined,
    }
  }
}
