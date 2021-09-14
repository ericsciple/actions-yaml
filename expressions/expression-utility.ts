import { FALSE, NULL, TRUE } from "./expression-constants"
import { ValueKind } from "./nodes"

export function formatValue(value: any, kind: ValueKind): string {
  switch (kind) {
    case ValueKind.Null:
      return NULL
    case ValueKind.Boolean:
      return value ? TRUE : FALSE
    case ValueKind.Number:
      return `${value}`
    case ValueKind.String: {
      const strValue = value as string
      return `'${stringEscape(strValue)}'`
    }
    case ValueKind.Array:
      return "Array"
    case ValueKind.Object:
      return "Object"
    default:
      // Should never reach here
      throw new Error(
        `Unable to convert to format value. Unexpected value kind '${kind}'`
      )
  }
}

export function testLegalKeyword(str: string): boolean {
  if (!str) {
    return false
  }

  const first = str[0]
  if (
    (first >= "a" && first <= "z") ||
    (first >= "A" && first <= "Z") ||
    first == "_"
  ) {
    for (let i = 0; i < str.length; i++) {
      const c = str[i]
      if (
        (c >= "a" && c <= "z") ||
        (c >= "A" && c <= "Z") ||
        (c >= "0" && c <= "9") ||
        c == "_" ||
        c == "-"
      ) {
        // Intentionally empty
      } else {
        return false
      }
    }

    return true
  } else {
    return false
  }
}

export function testPrimitive(kind: ValueKind): boolean {
  switch (kind) {
    case ValueKind.Null:
    case ValueKind.Boolean:
    case ValueKind.Number:
    case ValueKind.String:
      return true
    default:
      return false
  }
}

export function parseNumber(str: string): number {
  return Number(str)
}

export function stringEscape(value: string): string {
  return value.replace(/'/g, "''")
}

export function indent(level: number, str: string): string {
  const result: string[] = []
  for (let i = 0; i < level; i++) {
    result.push(str)
  }
  return result.join("")
}
