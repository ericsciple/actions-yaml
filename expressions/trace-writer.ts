export interface TraceWriter {
  info(message: string): void

  verbose(message: string): void
}

export class NoOperationTraceWriter implements TraceWriter {
  public info(message: string): void {}

  public verbose(message: string): void {}
}
