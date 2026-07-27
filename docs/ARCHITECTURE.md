# Clean integration architecture

The pipeline coordinates installed tools. It does not modify their source trees.

```text
ChatGPT Codex or Claude Code
        |
        +-- project files and prompts
        |
        +-- Google GenAI SDK ----> local visual assets
        |
        +-- Voicebox REST API ---> local narration
        |
        +-- HyperFrames CLI -----> preview, checks, render
```

## Voicebox

Install and run the released Voicebox app. The pipeline talks to the documented local service at
`http://127.0.0.1:17493`:

1. `POST /stories` opens a story named after the video.
2. `POST /generate` speaks one script line, then the run polls `GET /history/{id}` until it lands.
3. `POST /stories/{id}/items` places that clip on the timeline at an explicit start time.
4. `GET /stories/{id}/export-audio` downloads the finished mix.

Placing each line explicitly, rather than appending and hoping, is what makes the timing manifest
trustworthy. The run reads the placements back from `GET /stories/{id}` before writing it.

This keeps Voicebox independent: no copied code, no internal imports, no repository patches, and no
virtual environment inside a clone.

Claude Code can optionally call Voicebox tools directly through its documented MCP endpoint:

```sh
claude mcp add voicebox \
  --transport http \
  --url http://127.0.0.1:17493/mcp \
  --header "X-Voicebox-Client-Id: claude-code"
```

The pipeline itself uses REST because it is stable, scriptable, and works with either coding agent.

## HyperFrames

HyperFrames is invoked as a pinned npm package, for example:

```sh
npx --yes hyperframes@0.7.76 check
```

The pinned version is stored in each `video.json`, so an older video remains reproducible when the
latest package changes. A repository clone is unnecessary.

## Google GenAI

The project uses the official `@google/genai` package and reads `GEMINI_API_KEY` from the ignored
`.env` file. The key is never written into a video project or generated manifest.

The default image model and aspect ratio live in `templates/video.json`. If Google changes model
availability, update the template for future videos and only update an existing video's
`video.json` when you want to regenerate it.

## Agent boundary

`AGENTS.md` is the shared runbook for Codex. `CLAUDE.md` directs Claude Code to that same runbook.
The agent writes the creative inputs and HyperFrames composition, then pauses for a human preview
before rendering. The explicit `--approved` flag prevents an accidental final render.
