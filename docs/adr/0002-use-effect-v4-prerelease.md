# Use the Effect v4 prerelease for the Host

The Host uses exactly pinned, cohort-matched Effect v4 prerelease packages, beginning with `effect` and `@effect/platform-bun` at `4.0.0-rc.108`. Effect owns resource scopes, services, streams, retries, and shutdown; protocol encoding and fleet projection remain plain functions. This accepts prerelease API churn in exchange for the preferred v4 model while avoiding known concurrency defects in the final beta.
