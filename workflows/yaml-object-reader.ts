import fs from "fs"
import { isCollection, isDocument, isMap, isPair, isScalar, ParsedNode, parseDocument, Pair, Lexer } from "yaml"
import path from "path"
import { NodeBase } from "yaml/dist/nodes/Node"
import { ObjectReader } from '../templates/tokens'

class YamlObjectReader implements ObjectReader {

    private readonly generator: Generator<NodeBase>
    private currentNode: IteratorResult<NodeBase>
    private previousNode?: IteratorResult<NodeBase>


    constructor(filePath: string) {
        const file = fs.readFileSync(path.resolve(__dirname, filePath), "utf-8")
        this.generator = YamlObjectReader.getNodes(parseDocument(file))
        this.currentNode = this.generator.next() // document node
    }

    private static *getNodes(node: unknown): Generator<NodeBase, void> {

        if (isDocument(node)) {
            for (const item of YamlObjectReader.getNodes(node.contents)) {
                yield item
            }
        }

        if (isCollection(node)) {
            // yield new SequenceStart()
            for (const item of node.items) {
                for (const child of YamlObjectReader.getNodes(item)) {
                    yield child
                }
            }

            // yield SequenceTo
        }

        if (isScalar(node)) {
            yield node
        }

        if (isPair(node)) {
            yield node
            for (const child of YamlObjectReader.getNodes(node.value)) {
                yield child
            }
        }
    }

    public nextNode(): NodeBase {
        this.previousNode = this.currentNode
        this.currentNode = this.generator.next()
        return this.currentNode.value
    }

    allowLiteral() {
        if (!this.currentNode.done) {
            if (isScalar(this.currentNode.value)) {
                const value = this.currentNode.value;

            }
        }

        return undefined





    }

    allowSequenceStart() {
        return undefined
    }

    allowSequenceEnd() {
        return true
    }

    allowMappingStart() {
        return undefined
    }

    allowMappingEnd() {
        return true
    }

    validateStart() {

    }

    validateEnd() {

    }
}

var yamlReader = new YamlObjectReader("file.yml")
const file = fs.readFileSync(path.resolve(__dirname, "file.yml"), "utf-8")

var lexer = new Lexer();
for (const token of lexer.lex(file)) {
    console.log(JSON.stringify(token))
}

for (var i = 0; i < 25; i++) {
    console.log(JSON.stringify(yamlReader.nextNode()))
}







console.log()