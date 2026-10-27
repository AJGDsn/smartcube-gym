// Minimal ambient types for the Node globals the validation harnesses use at
// runtime (tsx provides the real implementations). Lets a harness set a CI exit
// code via `process.exitCode` (and a measurement script read its arguments via
// `process.argv`) without pulling all of @types/node into the scripts typecheck.
declare const process: { exitCode?: number; argv: string[] };
