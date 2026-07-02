# Agent guide
this is a nodejs javascript library.

- Plain JavaScript, no TypeScript
- No testing or linting is required unless requested
- If a task would be better handled by a js dependency, describe why and ask the user to install it manually.

## Code style
- Write terse javascript for modern environments
- Defensive try/catch blocks are not required
- Prefer small maintainable files
- all if statements should have brackets
- only simple ternary statements should be used
- Add terse comments and for maintainability, but not jsdoc
- tunable configuration variables should in a separate config.js file

## Workflow
- Work on the current branch. Do not make commits or pull requests. 
- Package manager: pnpm
- The user will be responsible for reviewing the results manually and may edit the code manually.
- Do not add dependencies or run third-party code unless given permission
