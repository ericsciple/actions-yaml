import { TemplateToken } from "../templates/tokens"
import { TraceWriter } from "../templates/trace-writer"
import * as templateReader from "../templates/template-reader"
import { WORKFLOW_ROOT } from "./workflow-constants"
import { JSONObjectReader } from "../templates/json-object-reader"
import { TemplateSchema } from "../templates/schema"
import * as fs from "fs"
import * as path from "path"

let schema: TemplateSchema

export function getWorkflowSchema(): TemplateSchema {
  if (schema === undefined) {
    const json = fs
      .readFileSync(path.join(__dirname, "workflow-schema.json"))
      .toString()
    schema = TemplateSchema.load(new JSONObjectReader(undefined, json))
  }
  return schema
}
