import fs from "fs"
import path from "path"
import { isCollection, isDocument, isMap, isPair, isScalar, isSeq, ParsedNode, parseDocument, Pair, Lexer, Scalar } from "yaml"
import { BooleanToken, NullToken, NumberToken, ObjectReader, StringToken, LiteralToken, SequenceToken, MappingToken } from '../templates/tokens'
import { ParseEvent, EventType } from '../templates/parse-event'

export class YamlObjectReader implements ObjectReader {

    private readonly _generator: Generator<ParseEvent>
    private _current!: IteratorResult<ParseEvent>
    private fileId?: number

    constructor(fileId: number | undefined, content: string) {
        this._generator = this.getNodes(parseDocument(content))
        this.fileId = fileId
    }

    private *getNodes(node: unknown): Generator<ParseEvent, void> {

        if (isDocument(node)) {
            yield new ParseEvent(EventType.DocumentStart)
            for (const item of this.getNodes(node.contents)) {
                yield item
            }
            yield new ParseEvent(EventType.DocumentEnd)
        }

        if (isCollection(node)) {
            if (isSeq(node)) {
                yield new ParseEvent(EventType.SequenceStart, new SequenceToken(this.fileId, undefined, undefined))
            } else if (isMap(node)) {
                yield new ParseEvent(EventType.MappingStart, new MappingToken(this.fileId, undefined, undefined))
            }

            for (const item of node.items) {
                for (const child of this.getNodes(item)) {
                    yield child
                }
            }
            if (isSeq(node)) {
                yield new ParseEvent(EventType.SequenceEnd)
            } else if (isMap(node)) {
                yield new ParseEvent(EventType.MappingEnd)
            }
        }

        if (isScalar(node)) {
            yield new ParseEvent(EventType.Literal, YamlObjectReader.getLiteralToken(this.fileId, node as Scalar))
        }

        if (isPair(node)) {
            var scalarKey = node.key as Scalar
            const key = scalarKey.value as string
            yield new ParseEvent(EventType.Literal, new StringToken(this.fileId, undefined, undefined, key))
            for (const child of this.getNodes(node.value)) {
                yield child
            }
        }
    }

    private static getLiteralToken(fileId: number | undefined, token: Scalar) {
        var value = token.value

        if (!value) {
            return new NullToken(fileId, undefined, undefined)
        }

        switch (typeof value) {
            case "number":
                return new NumberToken(fileId, undefined, undefined, value)
            case "boolean":
                return new BooleanToken(fileId, undefined, undefined, value)
            case "string":
                return new StringToken(fileId, undefined, undefined, value)
            default:
                throw new Error(
                    `Unexpected value type '${typeof value}' when reading object`
                )
        }
    }

    public allowLiteral(): LiteralToken | undefined {
        if (!this._current.done) {
            const parseEvent = this._current.value
            if (parseEvent.type === EventType.Literal) {
                this._current = this._generator.next()
                // console.log("ParseEvent=Literal")
                return parseEvent.token as LiteralToken
            }
        }

        return undefined
    }

    public allowSequenceStart(): SequenceToken | undefined {
        if (!this._current.done) {
            const parseEvent = this._current.value
            if (parseEvent.type === EventType.SequenceStart) {
                this._current = this._generator.next()
                // console.log("ParseEvent=SequenceStart")
                return parseEvent.token as SequenceToken
            }
        }

        return undefined
    }

    public allowSequenceEnd(): boolean {
        if (!this._current.done) {
            const parseEvent = this._current.value
            if (parseEvent.type === EventType.SequenceEnd) {
                this._current = this._generator.next()
                // console.log("ParseEvent=SequenceEnd")
                return true
            }
        }

        return false
    }

    public allowMappingStart(): MappingToken | undefined {
        if (!this._current.done) {
            const parseEvent = this._current.value
            if (parseEvent.type === EventType.MappingStart) {
                this._current = this._generator.next()
                // console.log("ParseEvent=MappingStart")
                return parseEvent.token as MappingToken
            }
        }

        return undefined
    }

    public allowMappingEnd(): boolean {
        if (!this._current.done) {
            const parseEvent = this._current.value
            if (parseEvent.type === EventType.MappingEnd) {
                this._current = this._generator.next()
                // console.log("ParseEvent=MappingEnd")
                return true
            }
        }

        return false
    }

    public validateEnd(): void {
        if (!this._current.done) {
            const parseEvent = this._current.value as ParseEvent
            if (parseEvent.type === EventType.DocumentEnd) {
                this._current = this._generator.next()
                // console.log("ParseEvent=DocumentEnd")
                return
            }
        }

        throw new Error("Expected end of reader")
    }

    public validateStart(): void {
        if (!this._current) {
            this._current = this._generator.next()
        }

        if (!this._current.done) {
            const parseEvent = this._current.value as ParseEvent
            if (parseEvent.type === EventType.DocumentStart) {
                this._current = this._generator.next()
                // console.log("ParseEvent=DocumentStart")
                return
            }
        }

        throw new Error("Expected start of reader")
    }
}
