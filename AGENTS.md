# ComfyUI Mini - Agent Instructions

## What this is
Internal ComfyUI custom-node module. Mobile/tablet-friendly web UI for running Comfy workflows. No real "build" or "test" pipeline — it's a Python module loaded by ComfyUI at runtime, serving HTML/JS under `/mini/*`.

## Directory structure
- `__init__.py` — the actual module entry point (all routes, save/load/run logic). This is where to look first.
- `comfyui-mini.py` — stub with empty NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS and a print statement. Not functional on its own; real code lives in `__init__.py`.
- `web/` — frontend:
  - `js/app.js` — the run page. State, diff-based `run()`, live-preview websocket handler, object_info caching, groups, workflow loading/saving. This is the big one.
  - `js/home.js`, `js/automation.js` — page-specific JS.
  - `index.html` — the **run** page (`/mini/run` serves this; only it loads `app.js`).
  - `home.html` — main/home page (workflow picker, links to Run/Gallery).
  - `automation.html` — automation runner (separate `/prompt` flow).
  - `gallery.html` — output/input browser: folder navigation, breadcrumbs, WebP thumbnails, favorites, and "send to workflow".
  - `editor.html` — layout editor.
  - `shared/header.html`, `shared/footer.html` — shared nav/footer fragments injected into the pages (the header's desktop nav must render; a past bug had a contradictory `md:hidden`/`hidden md:flex` pair that hid it).
  - `workflow.json` + `workflow.meta.json` — **active** workflow being edited. Logic and metadata are split into separate files for clean editing.
  - `layout.json` — UI layout state (node positions, visibility, heights).
  - `fooocus_styles.json` — Fooocus prompt/style presets.
  - `favorites.json` — server-side favorite image filenames (shared across devices).
- `web/workflows/` — library of saved workflows (.json). These are the source-of-truth copies.
- `web/workflows/meta/` — sidecar files for workflow library: `.meta.json` (node titles + `_mini_origin`) and `.groups.json` (group definitions).
- `web/backups/` — timestamped backup copies.
- `web/automations/` — automation queue definitions (filename + connected inputs/outputs per step).
- `web/thumbs/` — generated WebP thumbnails, cached by hash (see `/mini/thumb`).

## How the workflow system works
1. **Active vs library**: The active workflow lives in `web/workflow.json` + `web/workflow.meta.json`. Library copies live in `web/workflows/*.json` with sidecars in `web/workflows/meta/`. Selecting a library workflow (`POST /mini/select_workflow`) overwrites the active files, splitting logic and meta.
2. **Logic vs meta split**: `split_workflow_data()` separates node inputs/class_type (logic) from `_meta` and `MiniGroup` nodes. `_mini_origin` in meta tracks which library file this active workflow came from.
3. **Saving back**: When saving the active workflow with no suffix (`POST /mini/save_workflow`, query suffix=""), it syncs back to the originating library file AND updates its meta sidecar. Saving with a suffix writes only to `web/`.
4. **Groups**: Per-workflow group definitions stored as `{workflow}.groups.json` in META_DIR.

## How running works (the important new part)
The browser never uploads the full workflow per run. Instead:
1. **Baseline snapshot**: at page load `app.js` records `baselineWorkflow` (the graph as loaded from disk).
2. **Diff on Run**: `run()` diffs `loadedWorkflow` against `baselineWorkflow` and sends only changed/new nodes (each sent whole: `class_type` + `inputs`) plus `{file: _mini_origin, client_id}` to `POST /mini/run`.
3. **Server builds the prompt**: `/mini/run` reads the graph from disk (the library file if `file` is given and exists, else the active `web/workflow.json` + meta), applies the node-level diff, persists it back, randomizes KSampler seeds, builds `apiPrompt` (strips `_`-prefixed keys; `MiniGroup`/`Note`/`AppInfo` carry no `class_type`) and `metaWorkflow`, then calls `await execution.validate_prompt(prompt_id, api_prompt, None)` and `ps.prompt_queue.put((number, prompt_id, api_prompt, extra_data, outputs_to_execute, sensitive))` **in-process** (mirrors `server.post_prompt`). Returns `{prompt_id, number}`. No full-workflow upload, so it stays fast over the internet.
4. **Live sampling preview**: ComfyUI emits each sampling step as a **binary** websocket message. The client must NOT advertise `supports_preview_metadata` (it doesn't), so the server sends the legacy `UNENCODED_PREVIEW_IMAGE` frame: an 8-byte header (4-byte event type + 4-byte image-type), then JPEG/PNG bytes. `app.js` slices `e.data.slice(8)` into an `object-contain` `<img id="preview-image">` layered under a translucent `z-10` progress overlay. `clearPreview()` revokes the object URL at run start, on queue completion, and when the final full-res image arrives via `executed`.

## Routes (all prefixed `/mini`)
**Pages:** `/mini`, `/mini/run`, `/mini/gallery`, `/mini/editor`, `/mini/automation`
**Data:** `/mini/workflow.json`, `/mini/layout.json`, `/mini/fooocus_styles.json`
**Workflow CRUD:** `GET /mini/list_workflows`, `GET /mini/get_workflow?filename=` (merges the `.meta.json` sidecar), `POST /mini/select_workflow`, `POST /mini/upload_workflow` (multipart), `POST /mini/delete_workflow`, `POST /mini/save_workflow?suffix=`, `POST /mini/save_library`, `POST /mini/save_backup`
**Groups / layout:** `GET /mini/load_groups`, `POST /mini/save_groups`, `POST /mini/save_layout`
**Automations:** `POST /mini/save_automation`, `GET /mini/list_automations`, `GET /mini/load_automation?filename=`
**Files / images:** `GET /mini/files?type=&path=` → `{path, folders:[{name,count}], images:[{filename,subfolder,type}]}` (folders shallow-scanned for counts, path-traversal-guarded); `GET /mini/thumb?filename=&path=&type=&size=` → cached ≤size WebP; `POST /mini/bridge_image` (output/temp → input, returns `{filename}`, timestamp-suffix on collision)
**Favorites:** `GET /mini/load_favorites`, `POST /mini/save_favorites`
**Run:** `POST /mini/run` (diff-based, in-process queue)

## Gotchas
- `validate_prompt(prompt_id, prompt, partial_execution_list)` makes the **third argument required** in this ComfyUI build (no default). Calling it with two args raises `TypeError` → caught as a 500. Always pass `None` (no partial execution).
- The CLI default is `--preview-method NoPreviews` (`comfy/cli_args.py`). `/mini/run` must set `extra_data["preview_method"]` (default `"auto"` → Latent2RGB) or KSampler emits no preview bytes and the live preview never appears. The normal web UI gets previews because the frontend sends this in `extra_data`.
- The binary preview is routed to `server.client_id`, which `execute_async` sets from the prompt's `extra_data["client_id"]`. That must equal the websocket's `clientId` query param, or the frame is dropped. `app.js` uses one `clientId` for both.
- Binary preview frame is 8 bytes of header (event + image type) before the JPEG — do not change the `slice(8)` offset unless the ComfyUI protocol changes. If the client ever advertises `supports_preview_metadata`, the server switches to `PREVIEW_IMAGE_WITH_METADATA` instead.
- The module depends on ComfyUI internals: `server`, `folder_paths`, `execution`. It won't run standalone — must be loaded inside a running ComfyUI instance as a custom node.
- `_mini_origin` is the key linking the active workflow back to its library source. If this tag is lost, saves with no suffix and `POST /mini/run` won't sync back to the library file.
- Workflow library filenames with spaces are sanitized in automations but not in workflow names (raw `os.listdir`).
- `web/thumbs/` and `web/favorites.json` are runtime-generated; safe to delete (they rebuild). `web/thumbs/` is keyed by a hash that includes the source `mtime`, so it regenerates when an image changes.

## Testing / verification
No test framework, linter config, or build system exists. The only real "verification" is running ComfyUI and checking the UI works. For a quick syntax gate before pushing:
- Python: `python -m py_compile __init__.py`
- JS: `node --check` (copy `web/js/*.js` to a `.mjs` file first so the module syntax parses).

When modifying `__init__.py`, **ComfyUI must be restarted** — the module (and its routes) only load at startup. Frontend-only changes (JS/HTML) need just a hard refresh (Ctrl+Shift+R / pull-to-refresh). At minimum verify: import doesn't crash startup, routes register, and JSON save/load round-trips without corruption.

## Remote deployment workflow
- **Local edits first**: All code changes are made locally in this workspace (C:\Users\Dwayne\Documents\Programming\comfyui-mini).
- **Commit and push**: After editing, commit changes with descriptive messages and push to origin/main.
- **SSH MCP for remote pull**: Use the `ssh-mcp` tool on folder `J:\ComfyUI-Easy-Install-Windows\ComfyUI-Easy-Install\ComfyUI\custom_nodes\comfyui-mini` to run `git pull origin main` before testing. This ensures ComfyUI loads the latest version of your changes.
- **Restart**: After pulling a change that touched `__init__.py`, restart ComfyUI so the new routes/handlers register.
- **Then test**: Only after the remote pull completes should you use Chrome DevTools MCP to verify the UI works correctly on mobile/desktop viewports.
