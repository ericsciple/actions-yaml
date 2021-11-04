var fs = require("fs")

var schemaPath = "./workflows/workflow-schema.json"
var tsPath = "./workflows/workflow-schema.ts"
var schemaContent = fs
  .readFileSync(schemaPath)
  .toString()
var tsContent = fs.readFileSync(tsPath).toString()
var startToken =
  "// BEGIN GENERATED CONTENT - INSTEAD EDIT workflow-schema.json"
var endToken = "// END GENERATED CONTENT - INSTEAD EDIT workflow-schema.json"
var startIndex = tsContent.indexOf(startToken)
if (startIndex < 0) {
  throw new Error(
    "Unable to find start token when embedding workflow schema json"
  )
}
var endIndex = tsContent.indexOf(endToken)
if (endIndex < 0) {
  throw new Error(
    "Unable to find end token when embedding workflow schema json"
  )
}
tsContent = tsContent.substr(0, startIndex + startToken.length) + "\n  " + JSON.stringify(schemaContent) + "\n" + tsContent.substr(endIndex)
fs.writeFileSync(tsPath, tsContent)