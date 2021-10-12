# actions-yaml

- `./expressions/`
  - Generic expression library
- `./templates/`
  - Generic templating library
- `./actions/`
  - Actions-specific usage of templating

TODO:

- Handle errors in templating CLI
- Fix delimiter pattern in templating CLI
- YAML parser
  - Technically we don't have to do this (service could do this)
  - Find YAML parser (look into RedHat)
  - Make sure we can turn off anchors (memory DOS - e.g. billion laughs attack)
- Add workflow-specific stuff
  - actions-specific schema
  - CLI
  - deeper validation rules (i.e. stuff that pipeline-template-converter does)
- Interface with Actions Service
  - Side-by-side
  - Feature flag
  - Telemetry
  - CLI interface - critical section
  - Pool of processes? (low pri)
- Lower priority
  - Add secret masker into expressions
  - Crisply define pulic interface for SDK
  - Split into multiple packages
  - Better error message for mututally exclusive keys
