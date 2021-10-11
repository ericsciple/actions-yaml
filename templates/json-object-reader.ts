import {
  BooleanToken,
  LiteralToken,
  MappingToken,
  NullToken,
  NumberToken,
  ObjectReader,
  SequenceToken,
  StringToken,
  TemplateToken,
} from "./tokens"

export class JSONObjectReader implements ObjectReader {
  private readonly _fileId: number | undefined
  private readonly _generator: Generator<ParseEvent, void>
  private _current: IteratorResult<ParseEvent, void>

  public constructor(fileId: number | undefined, input: string) {
    this._fileId = fileId
    // todo: remove these or hide behind env var
    // console.log(`parsing: '${input}'`)
    const value = JSON.parse(input)
    this._generator = this.getParseEvents(value, true)
    this._current = this._generator.next()
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

  /**
   * Returns all tokens (depth first)
   */
  private *getParseEvents(
    value: any,
    root?: boolean
  ): Generator<ParseEvent, void> {
    if (root) {
      yield new ParseEvent(EventType.DocumentStart, undefined)
    }
    switch (typeof value) {
      case "undefined":
        yield new ParseEvent(
          EventType.Literal,
          new NullToken(this._fileId, undefined, undefined)
        )
        break
      case "boolean":
        yield new ParseEvent(
          EventType.Literal,
          new BooleanToken(this._fileId, undefined, undefined, value as boolean)
        )
        break
      case "number":
        yield new ParseEvent(
          EventType.Literal,
          new NumberToken(this._fileId, undefined, undefined, value as number)
        )
        break
      case "string":
        yield new ParseEvent(
          EventType.Literal,
          new StringToken(this._fileId, undefined, undefined, value as string)
        )
        break
      case "object":
        // null
        if (value === null) {
          yield new ParseEvent(
            EventType.Literal,
            new NullToken(this._fileId, undefined, undefined)
          )
        }
        // array
        else if (Object.prototype.hasOwnProperty.call(value, "length")) {
          yield new ParseEvent(
            EventType.SequenceStart,
            new SequenceToken(this._fileId, undefined, undefined)
          )
          for (const item of value as []) {
            for (const e of this.getParseEvents(item)) {
              yield e
            }
          }
          yield new ParseEvent(EventType.SequenceEnd, undefined)
        }
        // object
        else {
          yield new ParseEvent(
            EventType.MappingStart,
            new MappingToken(this._fileId, undefined, undefined)
          )
          for (const key of Object.keys(value)) {
            yield new ParseEvent(
              EventType.Literal,
              new StringToken(this._fileId, undefined, undefined, key)
            )
            for (const e of this.getParseEvents(value[key])) {
              yield e
            }
          }
          yield new ParseEvent(EventType.MappingEnd, undefined)
        }
        break
      default:
        throw new Error(
          `Unexpected value type '${typeof value}' when reading object`
        )
    }

    if (root) {
      yield new ParseEvent(EventType.DocumentEnd, undefined)
    }
  }
}

class ParseEvent {
  public readonly type: EventType
  public readonly token: TemplateToken | undefined
  public constructor(type: EventType, token: TemplateToken | undefined) {
    this.type = type
    this.token = token
  }
}

enum EventType {
  Literal,
  SequenceStart,
  SequenceEnd,
  MappingStart,
  MappingEnd,
  DocumentStart,
  DocumentEnd,
}
