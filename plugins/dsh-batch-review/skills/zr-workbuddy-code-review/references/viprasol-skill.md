---
name: code-review
description: Rigorous, prioritized code review of a diff, PR, or file — correctness bugs first, then security (OWASP/CWE), performance, API design, tests, and maintainability. Outputs severity-rated findings with specific fixes, not nitpicks. Use to review a pull request, audit a change, or pre-merge check.
version: 1.0.0
---

# Code Review

A disciplined, methodology-driven code review. The goal is **not** to leave many
comments — it is to find the issues that *matter*, rank them honestly by impact,
and propose a concrete fix for each. A review that flags one real
SQL-injection beats a review that flags twenty style nits and misses the bug.

This skill is grounded in established practice:

- **Correctness first.** Reviewers and research (Google, Microsoft, the SmartBear
  studies) converge on the same point: the highest-value defects found in review
  are logic and correctness defects, not formatting. Read for what the code
  *does* before what it *looks like*.
- **Security via OWASP / CWE.** The security pass is structured around the
  [OWASP Top 10](https://owasp.org/Top10/) categories and the corresponding
  [CWE](https://cwe.mitre.org/) weakness classes, so findings map to a recognized
  taxonomy instead of vibes.
- **Performance via Big-O reasoning.** Performance findings are justified by
  complexity and the cost model (allocations, round-trips, I/O), not by
  micro-optimization folklore.
- **"Comment on what matters, not nits."** In the spirit of Google's engineering
  code-review guidelines: distinguish things that must change from preferences,
  label preferences as such, and never block a merge on style when a linter or
  formatter could settle it.

---

## When to Activate

Activate this skill when the user:

- Shares a **diff**, **patch**, or **pull request** and asks for a review.
- Pastes a **file** or **function** and asks "is this correct / safe / any bugs?".
- Asks for a **pre-merge check**, **audit**, or **second pair of eyes**.
- Asks specifically to focus on **security**, **performance**, or **correctness**
  of a change (run the relevant pass with extra depth, but still do a quick
  sweep of the others).

If the request is "write code" or "explain code," this is not the right skill.
This skill *evaluates existing code*.

---

## Step 1: Scope & Context

Before reading line by line, establish what you are reviewing. State these back
to the user briefly so assumptions are visible:

- **What changed?** A diff/PR (review only the changed lines plus their blast
  radius) or a whole file (review all of it). For a diff, the surrounding
  unchanged code is context, not subject — but flag it if the change *makes* it
  wrong (e.g. a new caller breaks an old invariant).
- **Language & framework.** Determines the idioms, the footguns, and the
  security surface (e.g. Django ORM vs raw SQL, React vs server-rendered HTML).
- **Runtime & security surface.** Is this server-side, client-side, a CLI, a
  library, infra-as-code? Does it touch the network, the filesystem, a database,
  user input, authentication, money, or PII? The surface dictates which passes
  matter most.
- **Tests present?** Did the change add or modify tests? Is there existing
  coverage for the touched code? "No tests for a behavior change" is itself a
  finding.
- **Intent.** What is the change *supposed* to do? Review against intent — a
  correct implementation of the wrong thing is still a finding.

If critical context is missing (e.g. you cannot tell whether input is trusted),
say so explicitly and review for the worst plausible case.

---

## Step 2: Severity Model

Every finding gets exactly one severity. Be honest — inflating severity trains
people to ignore you; deflating it lets real bugs ship.

| Severity     | Meaning                                                                 | Blocks merge? |
|--------------|-------------------------------------------------------------------------|---------------|
| **Critical** | Data loss, security vulnerability, crash, or corruption in normal use.   | Yes           |
| **High**     | Wrong behavior / incorrect results for realistic inputs.                | Yes           |
| **Medium**   | Performance or design risk that will bite under load or over time.       | Usually       |
| **Low**      | Maintainability: unclear code, duplication, weak naming, missing docs.   | No            |
| **Nit**      | Pure style / preference a formatter or linter could decide.              | No            |

Rules:

- **Label nits as `Nit:` and never block on them.** If a formatter/linter can
  fix it, say so in one line and move on. Do not let nits dilute the signal.
- **One severity per finding.** If something is both a perf and a correctness
  problem, file it as the higher one and mention the other dimension.
- **Justify Critical/High.** State the input or condition that triggers the bad
  behavior. "Could be a problem" is not a finding; "with `n=0` this divides by
  zero" is.

---

## Step 3: Review Passes in Priority Order

Run the passes **in this order**. Earlier passes outrank later ones: a
correctness bug is more important than a naming nit on the same line. Each pass
is a checklist of concrete things to look for.

### (a) Correctness — *does it actually work?*

The highest-value pass. Read the changed logic and ask "for which input does
this do the wrong thing?"

- **Off-by-one / boundaries:** loop bounds, slice indices, `<` vs `<=`,
  inclusive/exclusive ranges, empty collections, single-element collections.
- **Null / undefined / None:** dereferencing a value that can be absent;
  Optionals unwrapped without a check; missing map keys; default-vs-missing.
- **Error handling:** swallowed exceptions; errors logged but not handled;
  ignored return/`error` values; partial failures that leave inconsistent state;
  cleanup that doesn't run on the error path (no `finally`/`defer`/`with`).
- **Edge cases:** zero, negative, empty string, very large input, Unicode,
  duplicate keys, the "happy path only" smell.
- **Concurrency / races:** shared mutable state without synchronization;
  check-then-act (TOCTOU); non-atomic read-modify-write; assuming ordering
  between async tasks; deadlock / lock-ordering.
- **Async / await:** missing `await` (fire-and-forget promise); awaiting in a
  loop that should be parallel; unhandled promise rejection; mixing callback and
  promise styles; `async` function whose error path is silently dropped.
- **Resource leaks:** files/sockets/connections/locks opened but not reliably
  closed; growing caches/listeners never released; goroutines/threads that never
  exit.
- **Numeric / floating-point:** `==` on floats; money in floats instead of
  integer minor units / decimal; integer overflow/truncation; rounding direction.
- **Time & timezones:** naive vs aware datetimes; assuming UTC; DST gaps;
  off-by-one on dates; comparing timestamps in different units (s vs ms).
- **Logic:** inverted conditions, wrong boolean operator, copy-paste of the
  wrong variable, fall-through, default branch missing.

### (b) Security — *can it be abused?* (OWASP / CWE)

Tag each finding with the relevant OWASP category and/or CWE id where it applies.

- **Injection** — SQL, NoSQL, OS command, LDAP, template. String-concatenated
  queries or shell commands from user input. *(OWASP A03; CWE-89 SQLi, CWE-78
  command injection, CWE-94 code injection.)*
- **Broken access control** — missing/incorrect authz checks; IDOR (acting on an
  object id without verifying ownership); trusting a client-supplied role/flag.
  *(OWASP A01; CWE-285, CWE-639.)*
- **Authentication gaps** — missing auth on a sensitive route; weak session
  handling; credentials compared non-constant-time. *(OWASP A07; CWE-287.)*
- **Secrets in code** — hardcoded API keys, passwords, tokens, private keys;
  secrets logged. *(CWE-798 hardcoded credentials, CWE-532 secrets in logs.)*
- **Unsafe deserialization** — `pickle`/`yaml.load`/Java native deserialization
  of untrusted data; prototype pollution. *(OWASP A08; CWE-502.)*
- **SSRF** — fetching a user-controlled URL without allow-listing the host.
  *(OWASP A10; CWE-918.)*
- **Path traversal** — joining user input into a filesystem path without
  normalization/containment. *(CWE-22.)*
- **XSS** — rendering untrusted data into HTML without escaping; `innerHTML` /
  `dangerouslySetInnerHTML`; unsanitized template output. *(OWASP A03; CWE-79.)*
- **Missing input validation** — trusting length/type/range/format of external
  input; mass assignment binding unexpected fields. *(CWE-20, CWE-915.)*
- **Insecure crypto / transport** — MD5/SHA1 for passwords (use bcrypt/argon2);
  ECB mode; static IV; disabled TLS verification; predictable randomness for
  tokens. *(OWASP A02; CWE-327, CWE-295, CWE-330.)*

### (c) Performance — *will it scale?* (Big-O + cost model)

Justify each finding with complexity or a concrete cost (round-trips, bytes,
allocations). Do not micro-optimize cold paths.

- **N+1 queries** — a query inside a loop over rows; missing eager-load/join.
- **Accidental O(n²)** — nested loops over the same collection; `in`/`indexOf` on
  a list inside a loop (use a set/map); repeated string concatenation in a loop.
- **Unnecessary allocations / copies** — copying large structures per iteration;
  building a full list when a generator/stream suffices; boxing in hot paths.
- **Blocking I/O on a hot path** — synchronous network/disk in a request handler
  or event loop; missing batching; chatty APIs.
- **Missing indexes** — querying/filtering on an unindexed column at scale.
- **Unbounded growth** — caches/queues/lists with no eviction or limit; loading
  an entire dataset into memory; recursion without depth bound.

### (d) API & Design — *is it well-shaped?*

- **Naming** — does the name say what it does? Misleading or vague names; verbs
  for queries with side effects.
- **Cohesion / responsibility** — function doing too much; mixed levels of
  abstraction; god object.
- **Leaky abstractions** — internal types/SQL/HTTP details bleeding through a
  public interface.
- **Backward compatibility** — removed/renamed public function, changed
  signature, changed default, changed serialization format, narrowed accepted
  input. Flag breaking changes explicitly and ask about versioning.
- **Error contracts** — what does this throw/return on failure? Is it consistent
  with siblings? Are errors typed/actionable or stringly-typed?

### (e) Tests — *is the change covered?*

- **Coverage for the change** — is the new/changed behavior actually exercised?
  A behavior change with no test is a finding.
- **Edge & negative cases** — only the happy path is tested; no test for the
  error path, empty input, or the boundary the code handles.
- **Flaky patterns** — reliance on real time/sleep, network, ordering of maps,
  shared global state between tests, randomness without a fixed seed.
- **Asserting implementation, not behavior** — tests that assert internal calls /
  private state and will break on refactor without catching real regressions;
  over-mocking that tests the mock.

### (f) Maintainability — *can the next person change it?*

- **Dead code** — unreachable branches, unused vars/imports/params, commented-out
  blocks.
- **Duplicated logic** — copy-paste that should be extracted; the same constant
  redefined.
- **Unclear names / magic numbers** — unexplained literals; abbreviations;
  single-letter names outside tight loops.
- **Comment quality** — comments that restate the code vs explain *why*; stale
  comments contradicting the code; missing doc on a non-obvious public API.

---

## Step 4: Red-Flags Quick Scan

Before (or alongside) the passes, do a fast scan for instant blockers. Any hit is
**Critical** until proven safe:

- Hardcoded secret / API key / password / private key.
- `eval` / `exec` / `Function()` / `system()` on anything derived from input.
- SQL/command built by string concatenation or f-string with a variable.
- TLS/cert verification disabled (`verify=False`, `rejectUnauthorized: false`,
  `InsecureSkipVerify: true`).
- Catch-all that swallows errors silently (`except: pass`, empty `catch {}`).
- A committed `.env`, credentials file, or key material in the diff.
- Infinite-loop / unbounded-recursion risk (loop with no progress toward exit).
- `dangerouslySetInnerHTML` / `innerHTML` with non-constant data.
- Disabled auth/permission check, or a `# TODO: add auth` on a live route.

---

## Step 5: Output Format

Produce the review in this structure. Be specific, cite the line, propose the
fix, and separate must-fix from nice-to-have.

### 1. Verdict

One line, one of:

- **Approve** — no blocking issues; any comments are Low/Nit.
- **Approve with comments** — safe to merge after addressing minor points; no
  Critical/High.
- **Request changes** — one or more Critical/High findings must be fixed first.

Follow with a one-sentence rationale.

### 2. Findings table

| ID | Location | Severity | Issue |
|----|----------|----------|-------|
| C1 | `path/file.py:42` | Critical | SQL injection via f-string query (CWE-89) |
| H1 | `path/file.py:31` | High | Endpoint missing ownership check (IDOR) |
| M1 | `path/file.py:55` | Medium | N+1 query inside the response loop |

Order by severity (Critical → Nit). Use stable IDs (`C1`, `H1`, `M2`, `L1`,
`N1`) so the user can reference them.

### 3. Per-finding detail

For each finding, in severity order:

> **[C1] SQL injection — `path/file.py:42` — Critical (CWE-89, OWASP A03)**
> **Why it matters:** the `user_id` value comes straight from the request and is
> interpolated into the query string, so an attacker can read or drop tables.
> **Fix:** use a parameterized query.
> ```python
> # before
> cur.execute(f"SELECT * FROM orders WHERE user_id = {user_id}")
> # after
> cur.execute("SELECT * FROM orders WHERE user_id = %s", (user_id,))
> ```

Every Critical/High **must** include the triggering condition and a concrete fix
(code where feasible). Mediums should include a fix or clear direction. Lows/Nits
can be one line each.

### 4. What's good

A short, genuine section acknowledging strengths — solid test coverage, a clean
abstraction, a good edge-case already handled. This is not filler: it calibrates
trust and signals you read the whole change, not just hunted for faults.

---

### Reviewer principles (carry through every review)

- **Be specific.** Cite `file:line`. "Somewhere there's a bug" helps no one.
- **Propose the fix.** A finding without a suggested direction is half a review.
- **Separate must-fix from nice-to-have.** The severity model is the contract.
- **Don't block on nits.** Label them, batch them, move on.
- **Review the code, not the author.** "This function…", not "you always…".
- **Stay within scope.** Note adjacent problems briefly, but don't rewrite the
  PR; the diff under review is the subject.
