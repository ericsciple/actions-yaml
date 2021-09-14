import { ContextData } from "../context-data"
import {
  CoreResult,
  EvaluationContext,
  FunctionNode,
  ResultMemory,
} from "../nodes"

export class FromJson extends FunctionNode {
  public override evaluateCore(context: EvaluationContext): CoreResult {
    const json = this.parameters[0].evaluate(context).convertToString()
    const contextData = ContextData.fromJSON(json)
    const memory = this.createMemoryCounter(context)
    memory.addContextData(contextData, true)
    return <CoreResult>{
      value: contextData,
      memory: new ResultMemory(memory.currentBytes, true),
    }
  }
}
