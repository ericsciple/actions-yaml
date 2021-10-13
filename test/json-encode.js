#!/usr/bin/env node

var fs = require("fs")
var content = fs.readFileSync(process.argv[2]).toString()
var jsonString = JSON.stringify(content)
console.log(jsonString.substr(1, jsonString.length - 2))
