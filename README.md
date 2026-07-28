# OpenAPI Visualizer

C# ASP.NET Core MVP for visualizing selected OpenAPI endpoint model graphs.

## Run

```powershell
dotnet run --urls http://localhost:5117
```

Open `http://localhost:5117/`, upload a JSON OpenAPI 3.x spec, search endpoints, and select a few endpoints to render a cycle-safe graph slice.

## MVP Scope

- Parses the whole JSON spec upfront on the backend.
- Indexes endpoints, component schemas, schema properties, schema references, and model cycles.
- Renders only selected endpoint graph slices.
- Shows model properties on node hover and click.
- Handles cyclic schema graphs without recursive expansion.

## Diffing from a git repository

Besides uploading two files by hand, the visualizer can build both sides of a diff itself from a
local git repository — either from two refs, or from a pull-request number.

Configuration lives in `appsettings.Local.json`, which is git-ignored because it contains paths and
hostnames specific to your machine. Copy `appsettings.Local.example.json` to get started; the
sidebar panel stays hidden until at least one source is configured.

A source declares which paths to extract and, optionally, which commands turn them into one
self-contained document:

```jsonc
"SpecDiff": {
  "Sources": [{
    "Name": "Petstore",
    "RepoPath": "C:\\src\\petstore-api",
    "ArchivePaths": [ "openapi" ],
    "Steps": [{
      "Command": "npx",
      "Arguments": "--yes @redocly/cli@latest bundle \"{tree}/openapi/openapi.yaml\" -o \"{output}\""
    }]
  }]
}
```

If the repository already commits a single self-contained spec, drop `Steps` and point `SpecFile` at
it instead. Placeholders: `{tree}` extracted archive root, `{work}` scratch space, `{output}` the
finished spec, `{repo}` the repository path.

How it works:

- Extraction uses `git archive`, which is read-only — your working copy is never checked out,
  modified, or cleaned, so this is safe to run against a repository you are working in.
- Only the paths you list are extracted, which keeps this fast even in a large monorepo.
- Built specs are cached by commit id. Commits are immutable, so a repeat view is instant and a
  base commit is shared across every pull request targeting it.
- Every prepared diff carries provenance — both refs, both commit ids, and how the base was
  chosen — shown in the UI, because two large specs look identical whether or not you compared
  the right things.

### Pull requests

Add an `Ado` section to a source to diff by pull-request number. The base is the target branch tip
and the head is the merge result, which answers "what does merging this do to the API". When a pull
request has conflicts there is no merge commit, so it falls back to merge-base against the source
head and says so in the provenance.

Authentication uses the current Windows identity by default, which is usually enough for an on-prem
server; set the `ADO_PAT` environment variable to a PAT with Code (read) scope otherwise.

Azure DevOps Services and Azure DevOps Server / TFS are supported. GitHub and GitLab are not yet
implemented — diffing two refs works with any git remote.

## Sample

`samples/tiny-openapi.json` contains a small model cycle for local testing.
