import { NamedContextInfo, FunctionInfo } from "../expressions/parser"
import { TemplateSchema } from "./schema"
import { TemplateMemory } from "./template-memory"
import { TemplateToken } from "./tokens"
import { TraceWriter } from "./trace-writer"
/**
 * Context object that is flowed through while loading and evaluating object templates
 */
export class TemplateContext {
  private readonly _fileIds: { [name: string]: number } = {}
  private readonly _fileNames: string[] = []

  /**
   * Available functions within expression contexts
   */
  public readonly expressionFunctions: FunctionInfo[] = []

  /**
   * Available values within expression contexts
   */
  public readonly expressionNamedContexts: NamedContextInfo[] = []

  public readonly errors: TemplateValidationErrors
  public readonly memory: TemplateMemory
  public readonly schema: TemplateSchema
  public readonly trace: TraceWriter
  public readonly state: { [key: string]: any } = {}

  public constructor(
    errors: TemplateValidationErrors,
    memory: TemplateMemory,
    schema: TemplateSchema,
    trace: TraceWriter
  ) {
    this.errors = errors
    this.memory = memory
    this.schema = schema
    this.trace = trace
  }

  public error(token: TemplateToken | undefined, err: string): void
  public error(token: TemplateToken | undefined, err: Error): void
  public error(token: TemplateToken | undefined, err: unknown): void
  public error(fileId: number | undefined, err: string): void
  public error(fileId: number | undefined, err: Error): void
  public error(fileId: number | undefined, err: unknown): void
  public error(
    tokenOrFileId: TemplateToken | number | undefined,
    err: string | Error | unknown
  ): void {
    const token = tokenOrFileId as TemplateToken | undefined
    const prefix = this.getErrorPrefix(
      token?.file ?? (tokenOrFileId as number | undefined),
      token?.line,
      token?.col
    )
    let message = (err as Error | undefined)?.message ?? `${err}`
    if (prefix) {
      message = `${prefix} ${message}`
    }

    this.errors.addFromMessage(message)
    this.trace.error(message)
  }

  /**
   * Gets or adds the file ID
   */
  public getFileId(file: string) {
    const key = file.toUpperCase()
    let id: number | undefined = this._fileIds[key]
    if (id === undefined) {
      id = this._fileNames.length + 1
      this._fileIds[key] = id
      this._fileNames.push(file)
      this.memory.addString(file)
    }

    return id
  }

  /**
   * Looks up a file name by ID. Returns undefined if not found.
   */
  public getFileName(fileId: number): string | undefined {
    return this._fileNames.length >= fileId
      ? this._fileNames[fileId - 1]
      : undefined
  }

  /**
   * Gets a copy of the file table
   */
  public getFileTable(): string[] {
    return this._fileNames.slice()
  }

  private getErrorPrefix(
    fileId?: number,
    line?: number,
    column?: number
  ): string {
    const fileName =
      fileId !== undefined ? this.getFileName(fileId as number) : undefined
    if (fileName) {
      if (line !== undefined && column !== undefined) {
        return `${fileName} (Line: ${line}, Col: ${column})`
      } else {
        return fileName
      }
    } else if (line !== undefined && column !== undefined) {
      return `(Line: ${line}, Col: ${column})`
    } else {
      return ""
    }
  }
}

/**
 * Provides information about errors which occurred during validation
 */
export class TemplateValidationErrors {
  private readonly _maxErrors: number
  private readonly _maxMessageLength: number
  private _errors: TemplateValidationError[] = []

  public constructor(maxErrors?: number, maxMessageLength?: number) {
    this._maxErrors = maxErrors ?? 0
    this._maxMessageLength = maxMessageLength ?? 0
  }

  public get count(): number {
    return this._errors.length
  }

  public addFromMessage(message: string): void {
    this.add(new TemplateValidationError(message))
  }

  public addFromError(err: unknown, messagePrefix?: string): void {
    let message = (err as Error | undefined)?.message || `${err}`
    if (messagePrefix) {
      message = `${messagePrefix} ${message}`
    }
    this.add(new TemplateValidationError(message))
  }

  public add(err: TemplateValidationError | TemplateValidationError[]): void {
    const errs = Object.prototype.hasOwnProperty.call(err, "length")
      ? (err as TemplateValidationError[])
      : ([err] as TemplateValidationError[])
    for (let e of errs) {
      // Check max errors
      if (this._maxErrors <= 0 || this._errors.length < this._maxErrors) {
        // Check max message length
        if (
          this._maxMessageLength > 0 &&
          e.message.length > this._maxMessageLength
        ) {
          e = new TemplateValidationError(
            e.message.substr(0, this._maxMessageLength) + "[...]",
            e.code
          )
        }

        this._errors.push(e)
      }
    }
  }

  /**
   * Throws if any errors
   * @param prefix The error message prefix
   */
  public check(prefix?: string): void {
    if (this._errors.length <= 0) {
      return
    }

    if (!prefix) {
      prefix = "The template is not valid."
    }

    throw new Error(`${prefix} ${this._errors.map((x) => x.message).join(",")}`)
  }

  public clear(): void {
    this._errors = []
  }

  public getErrors(): TemplateValidationError[] {
    return this._errors.slice()
  }
}

/**
 * Provides information about an error which occurred during validation
 */
export class TemplateValidationError {
  public readonly code: string | undefined
  public readonly message: string

  public constructor(message: string, code?: string) {
    this.message = message
    this.code = code
  }
}
