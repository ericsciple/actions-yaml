import { TemplateToken } from "../templates/tokens"
import { TraceWriter } from "../templates/trace-writer"
import * as templateReader from "../templates/template-reader"
import { WORKFLOW_ROOT } from "./workflow-constants"
import { YamlObjectReader } from "./yaml-object-reader"
import {
  TemplateContext,
  TemplateValidationError,
  TemplateValidationErrors,
} from "../templates/template-context"
import { TemplateMemory } from "../templates/template-memory"
import { File } from "./file"
import { getWorkflowSchema } from "./workflow-schema"

export interface ParseWorkflowResult {
  value: TemplateToken | undefined
  errors: TemplateValidationError[]
}

export function parseWorkflow(
  entryFileName: string,
  files: File[],
  trace: TraceWriter
): ParseWorkflowResult {
  const context = new TemplateContext(
    new TemplateValidationErrors(),
    new TemplateMemory(50, 1048576),
    getWorkflowSchema(),
    trace
  )
  files.forEach((x) => context.getFileId(x.name))
  const fileId = context.getFileId(entryFileName)
  const fileContent = files[fileId - 1].content
  const result = templateReader.readTemplate(
    context,
    WORKFLOW_ROOT,
    new YamlObjectReader(fileId, fileContent),
    fileId
  )
  return <ParseWorkflowResult>{
    value: result.value,
    errors: context.errors.getErrors(),
  }
}
