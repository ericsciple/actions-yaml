# actions-yaml

- `./expressions/`
  - Generic expression library
- `./templates/`
  - Generic templating library
  - template-reader.ts reads a file
    - reads DOM using ObjectReader interface; convert to TemplateToken; schema validate
  - template-evaluator.ts expands a TemplateToken
    - expands a TemplateToken; schema validates result
- `./actions/`
  - Actions-specific usage of templating

TODO:

- Templates CLI
  - Support expanding a token
  - Handle errors in templating CLI
  - Fix delimiter pattern in templating CLI
- YAML parser
  - Technically we don't have to do this (service could do this)
  - Find YAML parser (look into RedHat)
  - Make sure we can turn off anchors (memory DOS - e.g. billion laughs attack)
- Add workflow-specific stuff
  - CLI
    - Support batch of commands
  - AzDevNext today:
    - Initial YAML parse: /Users/eric/repos/azdevnext/src/Actions/Runtime/Client/WebApi/Pipelines/ObjectTemplating/PipelineTemplateParser.cs
- Testing
  - envsubst
  - jest

- Interface with Actions Service
  - Side-by-side
  - Feature flag
  - Telemetry
  - CLI interface - critical section
  - Pool of processes? (low pri)
- Lower priority
  - Add secret masker into expressions
  - Crisply define pulic interface for SDK
  - Split into multiple packages (yet make local changes work)
  - Better error message for mututally exclusive keys
  - Deeper validation rules (i.e. stuff that pipeline-template-converter does)

### Development Setup

```sh
npm install # install npm dependencies
npm run build # compile ts -> js
npm run test # run the tests
```
