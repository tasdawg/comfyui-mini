# ComfyUI Mini

Internal ComfyUI custom-node module. Mobile/tablet-friendly web UI for running Comfy workflows on the go.

## Features

- **Mobile-first UI**: Dark theme, touch-optimized controls, responsive layout
- **Floating Terminal Console**: Collapsible debug panel showing WebSocket status, workflow saves, prompt queue IDs, progress %, image generation events, and errors (color-coded: blue=info, green=success, yellow=warn, red=error)
- **Workflow Library**: Save/load workflows from `web/workflows/` with sidecar metadata (`*.meta.json`) and group definitions (`*.groups.json`)
- **Logic/Meta Split**: Active workflow stored as `workflow.json` (nodes + inputs) + `workflow.meta.json` (titles, `_mini_origin` tracking). Library copies kept in sync when saving without a suffix.

## Directory Structure

```
__init__.py              # Module entry point (all routes, save/load logic)
comfyui-mini.py          # Stub (empty NODE_CLASS_MAPPINGS — real code is in __init__.py)
web/
├── js/app.js            # Main app: state, API calls, groups, terminal console
├── index.html           # Runner page (/mini/run) with terminal at bottom
├── home.html            # Home page (/mini)
├── automation.html      # Automation page (/mini/automation)
├── workflow.json        # Active workflow (logic only)
├── workflow.meta.json   # Active workflow metadata (titles, _mini_origin)
├── layout.json          # UI state: node visibility + heights
├── fooocus_styles.json  # Fooocus prompt/style presets
├── workflows/           # Library of saved workflows (.json)
│   └── meta/            # Sidecars: *.meta.json, *.groups.json
├── backups/             # Timestamped backup copies (backup_<ts>.json)
└── automations/         # Automation queue definitions
```

## Routes (`/mini/*`)

**Pages:** `/mini`, `/mini/run`, `/mini/gallery`*, `/mini/editor`*, `/mini/automation`  
\* Not yet implemented — routes return 404 until `gallery.html` / `editor.html` exist.

**Data (GET):** `/mini/workflow.json`, `/mini/layout.json`, `/mini/fooocus_styles.json`

**Workflow CRUD:**
- `POST /mini/select_workflow?filename=` — overwrites active workflow from library
- `POST /mini/upload_workflow` (multipart) — upload a .json to the workflow library
- `POST /mini/save_workflow?suffix=` — save active; empty suffix syncs back to library origin
- `POST /mini/save_library` — force-save with `_save_name` in payload
- `POST /mini/save_backup` — timestamped backup

**Groups:** `/mini/load_groups`, `/mini/save_groups` (per-workflow `.groups.json`)  
**Automations:** `/mini/list_automations`, `/mini/load_automation?filename=`, `/mini/save_automation`  
**Files:** `/mini/files?path=` (Comfy output dir listing), `/mini/bridge_image` (output/temp → input)

## WebSocket Events Tracked in Terminal Console

| Event | Log Level | Description |
|-------|-----------|-------------|
| WS open/close | success / warn | Connection status, auto-reconnect on drop |
| Roll button press | info | "Rolling..." + workflow save trigger |
| `/prompt` response | info | Prompt queued with server-assigned ID |
| `progress` message | progress (gray) | Step percentage during generation |
| `executed` (image output) | success | Filename of generated image |
| `status` queue_remaining=0 | success | Execution finished, history fetch triggered |
| Run failure / interrupt | error / warn | Error message or STOP button pressed |

## Gotchas

- The module depends on ComfyUI internals (`server`, `folder_paths`). It won't run standalone — must be loaded inside a running ComfyUI instance as a custom node.
- `_mini_origin` in workflow meta links the active session back to its library source file. If this tag is lost, saves with no suffix won't sync to the library.
- Workflow library filenames with spaces are sanitized in automations but not in workflow names (raw `os.listdir`).
- No test framework or build pipeline exists. Verification: run ComfyUI and check the UI works.

## Setup

Drop this folder into your ComfyUI `custom_nodes/` directory. No pip install, no build step required. The module auto-registers routes on startup.
