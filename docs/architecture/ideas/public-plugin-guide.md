# Public plugin guide for any LLM (parked idea)

- Parked: 2026-10-11 (owner). For the owner and the ACA only: not on the board, no tasks, no milestone.
- **Not a decision.** Nothing here is accepted, and no agent acts on it. When the owner resumes it, it becomes ADRs and tasks through the normal process.
- Goal: publish instructions that let other LLM coding agents build emc2 plugins as well as Claude does here: ChatGPT/Codex, Grok, Mistral and Qwen.

## Why it can work

Claude's plugins came out well mainly because of three things that work for any model:
- a frozen contract (SDK v1, data model 1.0.0);
- a template to copy (`plugins/_template`);
- machine checks (the test kits, the architecture rules, schema validation, the build).

The Markdown style matters little. Every model reads Markdown, JSON Schema, TypeScript types and Javadoc.

## What has to change

1. **No internal process in the public text.** Today's SDK and design-pattern documents are full of the project's history:
   - task and CR numbers;
   - owner decisions with dates;
   - roles (MCA, PDA), handovers and ADR history.

   The guide states the current rules only.
2. **`AGENTS.md` as the entry point** of the public guide, not `CLAUDE.md`, which stays the project's own rules. It is the closest thing to a cross-tool standard (Linux Foundation): Codex reads it natively, and recent Qwen Code and Mistral Vibe reportedly do too. Claude-only parts (the `.claude/agents/` conformance reviewer, skills) cannot be relied on.
3. **Short entry, details by topic.** Long context files help coding agents little and can hurt.
4. **Checks instead of review prompts.** A `check` command replaces the Claude-only conformance review for plugins. "Done" means the check passes. This equalises models more than any wording does.
5. **No invented API calls.** Models differ most in how often they invent methods. The guide says to stop and report when something is missing. Exact signatures (`.d.ts` files, Javadoc) and the compile step catch the rest.
6. **A bundled single file** for chat-only use and small local models (`llms-full.txt` style), generated from the guide.

## Deliverables

1. **`AGENTS.md`**, at most two pages:
   - what a plugin is;
   - the MUST and MUST NOT rules;
   - the workflow: copy the template, rename, implement, run `check`;
   - where the details are.
2. **Topic guides**, each self-contained:
   - the manifest;
   - the Java part: workers, listeners, compute workers, store, documents, endpoints, settings;
   - the web part: context, services, live picture subscriptions, map view, background maps;
   - data model essentials: lon/lat order, labels, extensions, `dataType` and `dataSource`;
   - testing with the test kits;
   - packaging.
3. **Examples:**
   - complete minimal plugins (web only, server only, both);
   - a wrong example next to the right one for the rules most often broken: threads, locks, own sockets and files, other plugins' extensions, lat/lon order.
4. **The `check` command:**
   - the test kits' architecture rules;
   - the manifest schema, the id and namespace rules;
   - no internet unless declared;
   - no fixed colours (ADR-0029);
   - licences of the plugin's dependencies.
5. **API reference**, generated from the SDKs (`.d.ts`, Javadoc), published with the guide.
6. **The bundled single file**, generated, versioned with the SDK.

**One source (a proposal):** the public guide could become the SDK's primary documentation, and the internal documents would refer to it. There should not be two copies that drift apart.

## Decisions needed first

1. **External plugins.** Today every plugin lives in this repository (ADR-0015) and is built by its build (`CLAUDE.md` section 3, CR-0006). Third-party plugins need:
   - published SDK packages (npm and Maven, with the test kits);
   - a standalone template repository;
   - a package format for installing a plugin;
   - the SDK version ranges they may declare.
2. **Trust.** Plugins run in-process and are trusted (ADR-0003). The class loader is not a security boundary (T-035, note N8). Options:
   - trusted third parties only;
   - a review or signing step before installation;
   - plugins in separate processes, which the requirements list for a later phase.
3. **Licences:** the published SDK and guide under Apache-2.0 like the project, and which licences a third-party plugin may have.
4. **Publish only frozen SDK versions**, with the guide versioned with the SDK.

## Validation

1. A pilot with one non-Claude model on a small plugin, for example a utility, or an ingoing plugin with a test double.
2. Record:
   - whether it builds;
   - whether the tests and `check` pass;
   - how often a human had to step in.
3. Fix the guide where it misled, and repeat two or three rounds.
4. Then each target model once.

## When resumed

- **Timing:** after SDK v1 is on `main` and the M1 plugins have proven it, at the earliest after M1. The owner decides.
- **Possible work split** (a proposal for when the owner resumes it):
  - ACA: the structure and `AGENTS.md`, and ADRs for external plugins and trust;
  - PDA: the content, the examples, the template repository and the published SDK;
  - MCA: the `check` script and the publishing pipeline;
  - CRA and SRA: a review before publishing.
- **Open for the owner:**
  - which model to pilot first;
  - where to publish;
  - the trust model;
  - whether emc2 releases may install external plugins.

## Sources (2026-10-11)

- [AGENTS.md as an open standard under the Linux Foundation](https://codex.danielvaughan.com/2026/04/07/agents-md-open-standard-cross-tool-portability)
- [AGENTS.md compatibility overview](https://www.mintlify.com/agentsmd/agents.md/compatibility/overview)
- [Qwen Code and AGENTS.md support](https://thepromptshelf.dev/blog/qwen-code-agents-md-support-2026)
- [Mistral Vibe reads AGENTS.md (AgentsRoom)](https://agentsroom.dev/blog/agentsroom-now-supports-mistral-vibe)
- [Grok Build support (AgentsRoom, third-party claim)](https://agentsroom.dev/blog/agentsroom-now-supports-grok-build)
- [Evaluating AGENTS.md: are repository-level context files helpful?](https://arxiviq.substack.com/p/evaluating-agentsmd-are-repository)
- [AGENTS.md: less is more](https://developer.upsun.com/posts/ai/agents-md-less-is-more)
