import { TemplateToken } from "../templates/tokens"
import { TraceWriter } from "../templates/trace-writer"
import * as templateReader from "../templates/template-reader"
import { WORKFLOW_ROOT } from "./workflow-constants"
import { JSONObjectReader } from "../templates/json-object-reader"
import {
  TemplateContext,
  TemplateValidationErrors,
} from "../templates/template-context"
import { TemplateMemory } from "../templates/template-memory"
import { TemplateSchema } from "../templates/schema"
import * as fs from "fs"
import * as path from "path"
import { File } from "./file"

let schema: TemplateSchema

export function parseWorkflow(
  entryFileId: string,
  files: File[],
  trace: TraceWriter
): TemplateToken {
  if (schema === undefined) {
    const json = fs
      .readFileSync(path.join(__dirname, "workflow-schema.json"))
      .toString()
    schema = TemplateSchema.load(new JSONObjectReader(undefined, json))
  }

  const context = new TemplateContext(
    new TemplateValidationErrors(),
    new TemplateMemory(50, 1048576),
    schema,
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
