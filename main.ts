import * as workflowParser from "./workflows/workflow-parser"

const parseWorkflow = workflowParser.parseWorkflow
eval('global.__parseWorkflow = parseWorkflow')
