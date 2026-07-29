# ComfyUI Mini - Agent Instructions

## What this is
Internal ComfyUI custom-node module. Mobile/tablet-friendly web UI for running Comfy workflows. No real "build" or "test" pipeline — it's a Python module loaded by ComfyUI at runtime, serving HTML/JS under `/mini/*`.

## Directory structure
- `__init__.py` — the actual module entry point (all routes, save/load logic). This is where to look first.
- `comfyui-mini.py` — stub with empty NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS and a print statement. Not functional on its own; real code lives in `__init__.py`.
- `web/` — frontend:
  - `js/app.js` — main app (state, API calls, groups, workflow loading/saving)
  - `js/home.js`, `js/automation.js` — page-specific JS
  - `index.html`, `home.html`, `automation.html` — pages (no `gallery.html` or `editor.html` exist yet; routes in `__init__.py` reference them but they're missing)
  - `workflow.json` + `workflow.meta.json` — **active** workflow being edited. Logic and metadata are split into separate files for clean editing.
  - `layout.json` — UI layout state (node positions, visibility, heights)
  - `fooocus_styles.json` — Fooocus prompt/style presets
- `web/workflows/` — library of saved workflows (.json). These are the source-of-truth copies.
- `web/workflows/meta/` — sidecar files for workflow library: `.meta.json` (node titles) and `.groups.json` (group definitions).
- `web/backups/` — timestamped backup copies.
- `web/automations/` — automation queue definitions (filename + connected inputs/outputs per step).

## How the workflow system works
1. **Active vs library**: The active workflow lives in `web/workflow.json` + `web/workflow.meta.json`. Library copies live in `web/workflows/*.json` with sidecars in `web/workflows/meta/`. Selecting a library workflow (`POST /mini/select_workflow`) overwrites the active files, splitting logic and meta.
2. **Logic vs meta split**: `split_workflow_data()` separates node inputs/class_type (logic) from `_meta` and `MiniGroup` nodes. `_mini_origin` in meta tracks which library file this active workflow came from.
3. **Saving back**: When saving the active workflow with no suffix (`POST /mini/save_workflow`, query suffix=""), it syncs back to the originating library file AND updates its meta sidecar. Saving with a suffix writes only to `web/`.
4. **Groups**: Per-workflow group definitions stored as `{workflow}.groups.json` in META_DIR.

## Routes (all prefixed `/mini`)
**Pages:** `/mini`, `/mini/run`, `/mini/gallery`, `/mini/editor`, `/mini/automation`
**Data:** `/mini/workflow.json`, `/mini/layout.json`, `/mini/fooocus_styles.json`
**Workflow CRUD:** `GET /mini/list_workflows`, `GET /mini/get_workflow?filename=`, `POST /mini/select_workflow`, `POST /mini/upload_workflow` (multipart), `POST /mini/save_workflow?suffix=`, `POST /mini/save_library`, `POST /mini/save_backup`
**Groups:** `GET /mini/load_groups`, `POST /mini/save_groups`
**Automations:** `POST /mini/save_automation`, `GET /mini/list_automations`, `GET /mini/load_automation?filename=`
**Files:** `GET /mini/files?path=`, `POST /mini/bridge_image` (output/temp → input)

## Gotchas
- Routes for `/mini/gallery` and `/mini/editor` point to files that don't exist yet (`gallery.html`, `editor.html`). Adding these routes creates 404s until the HTML files are created.
- The module depends on ComfyUI internals: `server`, `folder_paths`. It won't run standalone — must be loaded inside a running ComfyUI instance as a custom node.
- `_mini_origin` is the key linking active workflow back to its library source. If this tag is lost, saves with no suffix won't sync to the library.
- Workflow library filenames with spaces are sanitized in automations but not in workflow names (raw `os.listdir`).

## Testing / verification
No test framework, linter config, or build system exists. The only "verification" is running ComfyUI and checking the UI works. When modifying Python code, at minimum verify: import doesn't crash ComfyUI startup, routes register correctly, JSON save/load round-trips without corruption.
