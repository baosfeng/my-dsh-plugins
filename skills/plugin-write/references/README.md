# plugin-write Reference Index

Read only the file needed for the task:

| File | When to read it |
|---|---|
| [naming-conventions.md](naming-conventions.md) | Check official naming compatibility and optional community collision recommendations |
| [registry-check.md](registry-check.md) | Query reviewed central registrations after offline naming validation and prepare a contextual registration |
| [version-adaptation.md](version-adaptation.md) | Adapt an existing plugin to a new Harness version |
| `tool-plugin.md` (trimmed) | Write a model-callable tool |
| `llm-adapter-plugin.md` (trimmed) | Connect a model provider |
| `hook-plugin.md` (trimmed) | Write event and policy hooks |
| `service-plugin.md` (trimmed) | Expose a service to other plugins |
| `config-plugin.md` (trimmed) | Define configurable plugin behavior |

> This repository ships a trimmed copy: the five form references above are not
> included — form coverage lives in the `dsh-plugin-development` skill's form
> table, and the mapping is in `SKILL.md`「再分类插件形态」.

For a new external plugin, read `naming-conventions.md`, then `registry-check.md` when a central lookup
or registration is needed, plus the matching form reference. For a version adaptation, read
`version-adaptation.md` first and then the matching form reference.
