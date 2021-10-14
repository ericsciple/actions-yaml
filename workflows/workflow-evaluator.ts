import { TemplateToken } from "../templates/tokens"
import { TraceWriter } from "../templates/trace-writer"
import * as templateEvaluator from "../templates/template-evaluator"
import { STRATEGY, WORKFLOW_ROOT } from "./workflow-constants"
import {
  TemplateContext,
  TemplateValidationError,
  TemplateValidationErrors,
} from "../templates/template-context"
import { TemplateMemory } from "../templates/template-memory"
import { DictionaryContextData } from "../expressions/context-data"
import { getWorkflowSchema } from "./workflow-schema"
import { SimpleNamedContextNode } from "../expressions/nodes"
import { NamedContextInfo } from "../expressions/parser"

export interface EvaluateWorkflowResult {
  value: TemplateToken | undefined
  errors: TemplateValidationError[]
}

export function evaluateStrategy(
  files: string[],
  context: DictionaryContextData,
  token: TemplateToken,
  trace: TraceWriter
): EvaluateWorkflowResult {
  const templateContext = new TemplateContext(
    new TemplateValidationErrors(),
    new TemplateMemory(50, 1048576),
    getWorkflowSchema(),
    trace
  )

  // Add each file name
  for (const file of files) {
    templateContext.getFileId(file)
  }

  // Add expression named contexts
  for (let i = 0; i < context.keyCount; i++) {
    templateContext.expressionNamedContexts.push(<NamedContextInfo>{
      name: context.getPair(i).key,
      createNode: () => new SimpleNamedContextNode(context.getPair(i).value),
    })
  }

  const value = templateEvaluator.evaluateTemplate(
    templateContext,
    STRATEGY,
    token,
    0,
    undefined
  )
  return <EvaluateWorkflowResult>{
    value: value,
    errors: templateContext.errors.getErrors(),
  }
}
