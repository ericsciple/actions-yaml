import { TemplateToken } from "../templates/tokens"
import { TraceWriter } from "../templates/trace-writer"
import * as templateReader from "../templates/template-reader"
import { WORKFLOW_ROOT } from "./workflow-constants"
import { JSONObjectReader } from "../templates/json-object-reader"
import { YamlObjectReader } from "./yaml-object-reader"
import {
  TemplateContext,
  TemplateValidationErrors,
} from "../templates/template-context"
import { TemplateMemory } from "../templates/template-memory"
import { File } from "./file"
import { getWorkflowSchema } from "./workflow-schema"

export function parseWorkflow(
  entryFileId: string,
  files: File[],
  trace: TraceWriter
): TemplateToken {
  const context = new TemplateContext(
    new TemplateValidationErrors(),
    new TemplateMemory(50, 1048576),
    getWorkflowSchema(),
    trace
  )
  const file = files.filter((x) => x.id === entryFileId)[0]
  if (!file) {
    throw new Error(`File '${entryFileId}' not found`)
  }

  const result = templateReader.readTemplate(
    context,
    WORKFLOW_ROOT,
    new JSONObjectReader(undefined, file.content),
    undefined
  )
  context.errors.check()
  return result.value
}
