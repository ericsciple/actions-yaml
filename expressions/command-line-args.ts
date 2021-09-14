/**
 * Parse command line arguments
 */
export class Arguments {
  public readonly flags: { [flag: string]: boolean } = {}

  public readonly options: { [name: string]: string } = {}

  public readonly arguments: string[] = []
}

const ARG_HELP_CODE = "ARG_HELP"
const ARGV_ERROR_CODE = "ARGV"

/**
 * Parses the command line arguments
 * @param {string[]} flags       Allowed flags
 * @param {string[]} options     Allowed options
 * @param {boolean} allowArgs    Whether to allow unnamed arguments
 */
export function parseArgs(
  flags: string[],
  options: string[],
  allowArgs: boolean
): Arguments {
  flags = flags || []
  options = options || []
  allowArgs = typeof allowArgs === "boolean" ? allowArgs : true

  const result = new Arguments()

  // Check for --help
  const argv = process.argv.slice(2)
  if (argv.some((x) => x === "--help")) {
    throwError("Help requested", ARG_HELP_CODE)
  }

  // Parse
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const nextArg = i + 1 < argv.length ? argv[i + 1] : undefined

    // Starts with "--"
    if (arg.startsWith("--")) {
      const name = arg.substr(2)

      // Legal flag
      if (flags.some((x) => x === name)) {
        result.flags[name] = true
        continue
      }

      // Unknown option
      if (!options.some((x) => x === name)) {
        throwError(`Unknown option '${name}'`)
      }

      // Missing value following option
      if (nextArg === undefined || nextArg.startsWith("--")) {
        throwError(`Option '${name}' must have a value`)
      }

      // Legal option
      result.options[name] = nextArg!
      i++
      continue
    }

    // Unexpected argument
    if (!allowArgs) {
      throwError(`Unexpected argument '${arg}'`)
    }

    // Legal argument
    result.arguments.push(arg)
  }

  return result
}

function throwError(message: string, code?: string) {
  const err = new Error(message)
  ;(err as any)["code"] = code || ARGV_ERROR_CODE
  throw err
}
