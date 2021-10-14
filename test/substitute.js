#!/usr/bin/env node

const fs = require("fs")
const path = require("path")

// arg 1 indicates the input file which contains replacement tokens
// arg 2 indicates the output file
// arg 3..N indicate the files that contain the replacement content

const inputFile = process.argv[2]
const outputFile = process.argv[3]
const replacementFiles = []
for (let i = 4; i < process.argv.length; i++) {
  replacementFiles.push(process.argv[i])
}

let content = fs.readFileSync(inputFile).toString()
for (let replacementFile of replacementFiles) {
  const token = "{{" + path.basename(replacementFile).split(".")[0] + "}}"
  const transform = path.basename(replacementFile).split(".")[1]
  let replacement = fs.readFileSync(replacementFile).toString()
  switch (transform) {
    case "raw":
      break
    case "json-encode":
      replacement = JSON.stringify(replacement)
      replacement = replacement.substr(1, replacement.length - 2)
      break
    default:
      throw new Error(`Unexpected transform type '${transform}'`)
  }
  for (;;) {
    let original = content
    content = content.replace(token, replacement)
    if (content === original) {
      break
    }
  }
}

fs.writeFileSync(outputFile, content)
