import os
import json
import shutil
import uuid
import random
import hashlib
import server
import time
import execution
from PIL import Image
from aiohttp import web
import folder_paths

# 1. Setup Directories
current_dir = os.path.dirname(os.path.realpath(__file__))
WEBROOT = os.path.join(current_dir, "web")
WORKFLOWS_DIR = os.path.join(WEBROOT, "workflows")
META_DIR = os.path.join(WORKFLOWS_DIR, "meta") 
BACKUPS_DIR = os.path.join(WEBROOT, "backups")
AUTOMATIONS_DIR = os.path.join(WEBROOT, "automations") 
THUMBS_DIR = os.path.join(WEBROOT, "thumbs")
OUTPUT_DIR = folder_paths.get_output_directory()

for d in [WORKFLOWS_DIR, META_DIR, BACKUPS_DIR, AUTOMATIONS_DIR, THUMBS_DIR]:
    if not os.path.exists(d): os.makedirs(d)

print(f"### ComfyMini: Initializing...")

# --- UTILS ---
def split_workflow_data(full_data):
    """Separates Logic (Nodes/Links) from Layout (Pos/Groups)"""
    if not isinstance(full_data, dict):
        return full_data, {}

    logic_data = {}
    meta_data = {}

    for node_id, node in full_data.items():
        if not isinstance(node, dict): 
            # Keep top-level keys like 'version' or 'extra' in logic
            logic_data[node_id] = node
            continue 

        logic_node = {
            "inputs": node.get("inputs", {}),
            "class_type": node.get("class_type", ""),
        }
        
        if node.get("class_type") == "MiniGroup":
            meta_data[node_id] = node
        else:
            logic_data[node_id] = logic_node
            if "_meta" in node:
                meta_data[node_id] = { "_meta": node["_meta"] }

    return logic_data, meta_data

def merge_workflow_data(logic_data, meta_data):
    if not isinstance(logic_data, dict):
        return logic_data
        
    merged = {}
    for node_id, node in logic_data.items():
        merged[node_id] = node
        if node_id in meta_data and isinstance(node, dict):
            if "_meta" in meta_data[node_id]:
                merged[node_id] = node.copy() 
                merged[node_id]["_meta"] = meta_data[node_id]["_meta"]

    for node_id, node in meta_data.items():
        if node_id not in merged:
            merged[node_id] = node
            
    return merged

# --- Page Routes ---
@server.PromptServer.instance.routes.get("/mini")
async def serve_home(request): return web.FileResponse(os.path.join(WEBROOT, "home.html"))
@server.PromptServer.instance.routes.get("/mini/run")
async def serve_runner(request): return web.FileResponse(os.path.join(WEBROOT, "index.html"))
@server.PromptServer.instance.routes.get("/mini/gallery")
async def serve_gallery(request): return web.FileResponse(os.path.join(WEBROOT, "gallery.html"))
@server.PromptServer.instance.routes.get("/mini/editor")
async def serve_editor(request): return web.FileResponse(os.path.join(WEBROOT, "editor.html"))
@server.PromptServer.instance.routes.get("/mini/automation")
async def serve_automation(request): return web.FileResponse(os.path.join(WEBROOT, "automation.html"))

# --- Static & Data ---
server.PromptServer.instance.routes.static("/mini/js", path=os.path.join(WEBROOT, "js"))
server.PromptServer.instance.routes.static("/mini/shared", path=os.path.join(WEBROOT, "shared"))

@server.PromptServer.instance.routes.get("/mini/workflow.json")
async def serve_workflow(request):
    try:
        wf_path = os.path.join(WEBROOT, "workflow.json")
        meta_path = os.path.join(WEBROOT, "workflow.meta.json")
        logic = {}; meta = {}
        
        if os.path.exists(wf_path):
            with open(wf_path, 'r', encoding='utf-8') as f: logic = json.load(f)
            
        if os.path.exists(meta_path):
            try:
                with open(meta_path, 'r', encoding='utf-8') as f: meta = json.load(f)
            except: 
                print("[ComfyMini] Warning: workflow.meta.json corrupted, ignoring.")
                meta = {}
            
        return web.json_response(merge_workflow_data(logic, meta))
    except Exception as e:
        return web.json_response({})

@server.PromptServer.instance.routes.get("/mini/layout.json")
async def serve_layout(request):
    path = os.path.join(WEBROOT, "layout.json")
    if os.path.exists(path): return web.FileResponse(path)
    return web.json_response([])

@server.PromptServer.instance.routes.get("/mini/fooocus_styles.json")
async def serve_styles(request): return web.FileResponse(os.path.join(WEBROOT, "fooocus_styles.json"))

# --- API ---
@server.PromptServer.instance.routes.get("/mini/list_workflows")
async def list_workflows(request):
    try:
        if not os.path.exists(WORKFLOWS_DIR):
            return web.json_response({"workflows": []})
        files = [f for f in os.listdir(WORKFLOWS_DIR) if f.endswith('.json') and os.path.isfile(os.path.join(WORKFLOWS_DIR, f))]
        files.sort(key=lambda x: os.path.getmtime(os.path.join(WORKFLOWS_DIR, x)), reverse=True)
        return web.json_response({"workflows": files})
    except Exception as e: return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/mini/get_workflow")
async def get_workflow(request):
    filename = request.query.get("filename")
    if not filename: return web.json_response({"error": "No filename"}, status=400)
    try:
        file_path = os.path.join(WORKFLOWS_DIR, filename)
        if not os.path.exists(file_path):
             return web.json_response({"error": "File not found"}, status=404)
             
        with open(file_path, 'r', encoding='utf-8') as f: 
            logic = json.load(f)
        
        meta_filename = filename.replace('.json', '.meta.json')
        meta_path = os.path.join(META_DIR, meta_filename)
        meta = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path, 'r', encoding='utf-8') as f: meta = json.load(f)
            except Exception as e: pass
        
        return web.json_response(merge_workflow_data(logic, meta))
    except Exception as e: 
        return web.json_response({"error": f"Server Error: {str(e)}"}, status=500)

@server.PromptServer.instance.routes.post("/mini/select_workflow")
async def select_workflow(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        if not filename: return web.json_response({"error": "No filename"}, status=400)
        
        src_path = os.path.join(WORKFLOWS_DIR, filename)
        if not os.path.exists(src_path):
            return web.json_response({"error": f"File {filename} not found"}, status=404)

        with open(src_path, 'r', encoding='utf-8') as f:
            full_data = json.load(f)

        logic, meta = split_workflow_data(full_data)
        
        meta_filename = filename.replace('.json', '.meta.json')
        src_meta = os.path.join(META_DIR, meta_filename)
        if os.path.exists(src_meta):
            try:
                with open(src_meta, 'r', encoding='utf-8') as f:
                    existing_meta = json.load(f)
                    meta.update(existing_meta)
            except: pass

        meta["_mini_origin"] = filename

        wf_target = os.path.join(WEBROOT, "workflow.json")
        meta_target = os.path.join(WEBROOT, "workflow.meta.json")

        if os.path.exists(wf_target): os.remove(wf_target)
        if os.path.exists(meta_target): os.remove(meta_target)
        time.sleep(0.1)

        with open(wf_target, 'w', encoding='utf-8') as f:
            json.dump(logic, f, indent=2)
            os.fsync(f.fileno())
            
        with open(meta_target, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2)
            os.fsync(f.fileno())

        return web.json_response({"status": "success"})
    except Exception as e: 
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/mini/upload_workflow")
async def upload_workflow(request):
    reader = await request.multipart()
    field = await reader.next()
    if field.name == 'file':
        filename = os.path.basename(field.filename)
        if not filename.endswith('.json'): filename += '.json'
        filename = os.path.basename(filename) 
        
        with open(os.path.join(WORKFLOWS_DIR, filename), 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk: break
                f.write(chunk)
        return web.json_response({"status": "success", "filename": filename})
    return web.json_response({"error": "No file"}, status=400)

@server.PromptServer.instance.routes.post("/mini/delete_workflow")
async def delete_workflow(request):
    try:
        data = await request.json()
        filename = data.get("filename", "")
        if not filename or not filename.endswith('.json'):
            return web.json_response({"error": "Invalid filename"}, status=400)

        base = filename.replace('.json', '')
        wf_path = os.path.join(WORKFLOWS_DIR, filename)
        meta_path = os.path.join(META_DIR, f"{base}.meta.json")
        groups_path = os.path.join(META_DIR, f"{base}.groups.json")

        deleted = []
        for p in [wf_path, meta_path, groups_path]:
            if os.path.exists(p):
                try: os.remove(p); deleted.append(os.path.basename(p))
                except OSError as e: pass
                continue
            elif not os.path.exists(WORKFLOWS_DIR) and not os.path.exists(META_DIR):
                return web.json_response({"error": f"Directory missing"}, status=500)

        if filename not in deleted and not any(os.path.basename(p) in deleted for p in [wf_path, meta_path, groups_path]):
            if os.path.exists(wf_path) or os.path.exists(meta_path) or os.path.exists(groups_path):
                return web.json_response({"error": "Delete failed"}, status=500)

        return web.json_response({"status": "deleted", "files": deleted})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp', '.gif')

@server.PromptServer.instance.routes.get("/mini/files")
async def list_files(request):
    folder_type = request.query.get("type", "output")  # "output" or "input"
    subfolder = request.query.get("path", "")
    
    if folder_type == "input":
        src_dir = folder_paths.get_input_directory()
    else:
        src_dir = OUTPUT_DIR
    
    target_path = os.path.abspath(os.path.join(src_dir, subfolder))
    allowed_base = os.path.abspath(src_dir)
    if not target_path.startswith(allowed_base): return web.json_response({"error": "Invalid"}, status=403)
    if not os.path.exists(target_path): return web.json_response({"path": subfolder, "folders": [], "images": []})
    
    folders = []; images = []
    try:
        for item in os.listdir(target_path):
            if item.startswith('.'): continue
            full_path = os.path.join(target_path, item)
            if os.path.isdir(full_path):
                # One shallow listdir per subfolder so folder tiles can show an item count.
                try:
                    count = sum(1 for f in os.listdir(full_path)
                                if not f.startswith('.') and f.lower().endswith(IMAGE_EXTS))
                except OSError:
                    count = 0
                folders.append({"name": item, "count": count})
            elif item.lower().endswith(IMAGE_EXTS):
                images.append({ "filename": item, "subfolder": subfolder, "type": folder_type })
        folders.sort(key=lambda x: x["name"].lower()); images.sort(key=lambda x: x['filename'], reverse=True)
        return web.json_response({"path": subfolder, "folders": folders, "images": images})
    except Exception as e: return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/mini/thumb")
async def serve_thumb(request):
    """Small cached WebP thumbnail so mobile grids don't download full-size images."""
    filename = request.query.get("filename", "")
    subfolder = request.query.get("path", "")
    folder_type = request.query.get("type", "output")
    try: size = int(request.query.get("size", "360"))
    except ValueError: size = 360
    size = max(64, min(size, 800))

    if not filename or not filename.lower().endswith(IMAGE_EXTS):
        return web.Response(status=400)

    src_dir = folder_paths.get_input_directory() if folder_type == "input" else OUTPUT_DIR
    target_path = os.path.abspath(os.path.join(src_dir, subfolder))
    allowed_base = os.path.abspath(src_dir)
    if not target_path.startswith(allowed_base): return web.Response(status=403)

    src_path = os.path.join(target_path, os.path.basename(filename))
    if not os.path.isfile(src_path): return web.Response(status=404)

    try: mtime = os.path.getmtime(src_path)
    except OSError: return web.Response(status=404)

    key = hashlib.sha1(f"{folder_type}|{subfolder}|{filename}|{size}|{int(mtime)}".encode("utf-8")).hexdigest()
    cache_path = os.path.join(THUMBS_DIR, f"{key}.webp")
    if os.path.isfile(cache_path):
        return web.FileResponse(cache_path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    try:
        with Image.open(src_path) as img:
            img.thumbnail((size, size))
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")
            img.save(cache_path, "WEBP", quality=70)
        return web.FileResponse(cache_path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
    except Exception as e:
        print(f"[ComfyMini] Thumb generation failed for {filename}: {e}")
        return web.Response(status=404)

@server.PromptServer.instance.routes.post("/mini/save_workflow")
async def save_active_workflow(request):
    try:
        full_data = await request.json()
        
        # Check payload first for origin, fallback to disk
        origin_file = full_data.get("_mini_origin")
        
        logic, meta = split_workflow_data(full_data)
        
        suffix = request.query.get("suffix", "")
        target_filename = f"workflow{suffix}.json"
        target_meta_filename = f"workflow{suffix}.meta.json"

        current_meta_path = os.path.join(WEBROOT, "workflow.meta.json")
        
        # If payload didn't have origin, try loading from existing meta
        if not origin_file and os.path.exists(current_meta_path):
            try:
                with open(current_meta_path, 'r', encoding='utf-8') as f:
                    old_meta = json.load(f)
                    if "_mini_origin" in old_meta: 
                        origin_file = old_meta["_mini_origin"]
            except: pass
            
        # Ensure meta has the origin tag
        if origin_file:
            meta["_mini_origin"] = origin_file

        with open(os.path.join(WEBROOT, target_filename), 'w', encoding='utf-8') as f: 
            json.dump(logic, f, indent=2)
            
        with open(os.path.join(WEBROOT, target_meta_filename), 'w', encoding='utf-8') as f: 
            json.dump(meta, f, indent=2)

        # SYNC TO LIBRARY
        if suffix == "" and origin_file:
            print(f"[ComfyMini] Syncing save to library: {origin_file}")
            with open(os.path.join(WORKFLOWS_DIR, origin_file), 'w', encoding='utf-8') as f:
                json.dump(logic, f, indent=2)
            
            meta_name = origin_file.replace('.json', '.meta.json')
            lib_meta = meta.copy()
            if "_mini_origin" in lib_meta: del lib_meta["_mini_origin"]
            
            with open(os.path.join(META_DIR, meta_name), 'w', encoding='utf-8') as f:
                json.dump(lib_meta, f, indent=2)

        return web.json_response({"status": "success"})
    except Exception as e: 
        return web.json_response({"status": "error", "message": str(e)}, status=500)

# --- SERVER-SIDE RUN ---
# The browser only sends the input edits it made since load. The graph
# (class_type + connections) stays on disk, is read here, the diff is applied,
# the result is persisted, and the prompt is queued IN-PROCESS (no /prompt
# HTTP round-trip, no full workflow upload from the browser).
@server.PromptServer.instance.routes.post("/mini/run")
async def mini_run(request):
    try:
        body = await request.json()
        file = body.get("file")            # optional library filename (e.g. "X.json")
        diff_nodes = body.get("nodes", {})  # {nodeId: {class_type, inputs}} for changed/new nodes
        client_id = body.get("client_id", "")

        # 1. Locate the graph on disk.
        if file and os.path.exists(os.path.join(WORKFLOWS_DIR, file)):
            logic_path = os.path.join(WORKFLOWS_DIR, file)
            meta_path = os.path.join(META_DIR, file.replace(".json", ".meta.json"))
        else:
            logic_path = os.path.join(WEBROOT, "workflow.json")
            meta_path = os.path.join(WEBROOT, "workflow.meta.json")

        logic = {}
        if os.path.exists(logic_path):
            with open(logic_path, "r", encoding="utf-8") as f: logic = json.load(f)

        meta = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f: meta = json.load(f)
            except Exception:
                meta = {}

        # 2. Apply the changed/new nodes on top of the on-disk graph.
        for node_id, node_data in diff_nodes.items():
            if not isinstance(node_data, dict):
                continue
            logic[node_id] = {
                "inputs": node_data.get("inputs", {}),
                "class_type": node_data.get("class_type", ""),
            }

        # 3. Persist the updated graph so the edits survive a reload.
        with open(logic_path, "w", encoding="utf-8") as f:
            json.dump(logic, f, indent=2)
            os.fsync(f.fileno())

        # 4. Merge logic + meta for execution.
        merged = merge_workflow_data(logic, meta)

        # 5. Fresh seed on every run (matches the previous client-side behaviour).
        for node in merged.values():
            if isinstance(node, dict) and node.get("class_type") == "KSampler":
                if isinstance(node.get("inputs"), dict) and "seed" in node["inputs"]:
                    node["inputs"]["seed"] = random.randint(0, 2 ** 32 - 1)

        # 6. Build the API prompt (strip _ keys, non-node entries, UI-only nodes).
        api_prompt = {}
        for node_id, node in merged.items():
            if node_id.startswith("_"): continue
            if not isinstance(node, dict): continue
            if not node.get("class_type"): continue
            if node.get("class_type") in ("MiniGroup", "Note", "AppInfo"): continue
            api_prompt[node_id] = {
                "inputs": node.get("inputs", {}),
                "class_type": node["class_type"],
            }

        # 7. Build the meta-workflow (for the PNG sidecar / history).
        meta_workflow = { "nodes": [], "links": [], "groups": [], "version": 0.4 }
        for node_id, node in merged.items():
            if not isinstance(node, dict): continue
            try: node_id_num = int(node_id)
            except (ValueError, TypeError): node_id_num = node_id
            meta_workflow["nodes"].append(
                { "id": node_id_num, "type": node.get("class_type", ""), **node }
            )

        # 8. Validate and queue IN-PROCESS (same call /prompt makes, no HTTP).
        prompt_id = str(uuid.uuid4())
        ps = server.PromptServer.instance
        valid = await execution.validate_prompt(prompt_id, api_prompt, None)
        if not valid[0]:
            return web.json_response({"error": valid[1], "node_errors": valid[3]}, status=400)

        outputs_to_execute = valid[2]
        extra_data = { "extra_pnginfo": { "workflow": meta_workflow } }
        if client_id: extra_data["client_id"] = client_id
        # The CLI default preview method is NoPreviews. The standard frontend
        # sends preview_method (default "auto") in extra_data, which
        # execute_async feeds to set_preview_method(). We bypass that frontend,
        # so supply it here or KSampler emits no preview bytes at all and the
        # live preview never appears. "auto" -> Latent2RGB, same as the web UI.
        extra_data.setdefault("preview_method", body.get("preview_method") or "auto")

        sensitive = {}
        for k in execution.SENSITIVE_EXTRA_DATA_KEYS:
            if k in extra_data: sensitive[k] = extra_data.pop(k)
        extra_data["create_time"] = int(time.time() * 1000)

        number = ps.number
        ps.number += 1
        ps.prompt_queue.put((number, prompt_id, api_prompt, extra_data, outputs_to_execute, sensitive))

        return web.json_response({"prompt_id": prompt_id, "number": number})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/mini/save_library")
async def save_library(request):
    try:
        full_data = await request.json()
        filename = full_data.pop("_save_name", None)
        if not filename: return web.json_response({"status": "error", "message": "No filename"}, status=400)
        if not filename.endswith('.json'): filename += '.json'

        logic, meta = split_workflow_data(full_data)
        if "_mini_origin" in meta: del meta["_mini_origin"]

        with open(os.path.join(WORKFLOWS_DIR, filename), 'w', encoding='utf-8') as f: json.dump(logic, f, indent=2)
        meta_filename = filename.replace('.json', '.meta.json')
        with open(os.path.join(META_DIR, meta_filename), 'w', encoding='utf-8') as f: json.dump(meta, f, indent=2)
        return web.json_response({"status": "success", "file": filename})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/mini/save_backup")
async def save_backup(request):
    try:
        full_data = await request.json()
        logic, meta = split_workflow_data(full_data)
        ts = int(time.time())
        with open(os.path.join(BACKUPS_DIR, f"backup_{ts}.json"), 'w', encoding='utf-8') as f: json.dump(logic, f, indent=2)
        with open(os.path.join(BACKUPS_DIR, f"backup_{ts}.meta.json"), 'w', encoding='utf-8') as f: json.dump(meta, f, indent=2)
        return web.json_response({"status": "success", "file": f"backup_{ts}.json"})
    except Exception as e: return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/mini/save_layout")
async def save_layout(request):
    data = await request.json()
    with open(os.path.join(WEBROOT, "layout.json"), 'w', encoding='utf-8') as f: json.dump(data, f, indent=2)
    return web.json_response({"status": "success"})

@server.PromptServer.instance.routes.get("/mini/load_groups")
async def load_groups(request):
    try:
        target_filename = request.query.get("filename")
        if not target_filename:
            meta_path = os.path.join(WEBROOT, "workflow.meta.json")
            if os.path.exists(meta_path):
                with open(meta_path, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                    if "_mini_origin" in meta:
                        target_filename = meta["_mini_origin"]
        
        if not target_filename: return web.json_response([])

        if target_filename.endswith('.json'):
            target_filename = target_filename[:-5]
        
        group_file = target_filename + ".groups.json"
        groups_path = os.path.join(META_DIR, group_file)
        
        if os.path.exists(groups_path):
            with open(groups_path, 'r', encoding='utf-8') as f:
                return web.json_response(json.load(f))
        
        return web.json_response([])
    except Exception as e:
        print(f"Error loading groups: {e}")
        return web.json_response([])

@server.PromptServer.instance.routes.post("/mini/save_groups")
async def save_groups(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        groups = data.get("groups")
        
        if not filename: return web.json_response({"error": "No filename provided"}, status=400)

        if filename.endswith('.json'): filename = filename[:-5]
        target_filename = filename + ".groups.json"
        
        save_path = os.path.join(META_DIR, target_filename)
        
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(groups, f, indent=2)
            
        return web.json_response({"status": "success"})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# --- AUTOMATION & BRIDGE ---
@server.PromptServer.instance.routes.post("/mini/save_automation")
async def save_automation(request):
    try:
        data = await request.json()
        name = data.get("name")
        queue = data.get("queue")
        
        if not name: return web.json_response({"error": "No name provided"}, status=400)
        
        safe_name = "".join([c for c in name if c.isalnum() or c in (' ', '-', '_')]).strip()
        filename = f"{safe_name}.json"
        
        save_data = [{ "filename": step["filename"], "connectedOutput": step.get("connectedOutput"), "connectedInput": step.get("connectedInput") } for step in queue]
        
        with open(os.path.join(AUTOMATIONS_DIR, filename), 'w', encoding='utf-8') as f:
            json.dump(save_data, f, indent=2)
            
        return web.json_response({"status": "success", "file": filename})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/mini/list_automations")
async def list_automations(request):
    try:
        if not os.path.exists(AUTOMATIONS_DIR):
            return web.json_response({"automations": []})
        files = [f for f in os.listdir(AUTOMATIONS_DIR) if f.endswith('.json')]
        return web.json_response({"automations": files})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/mini/load_automation")
async def load_automation(request):
    filename = request.query.get("filename")
    if not filename: return web.json_response({"error": "No filename"}, status=400)
    try:
        path = os.path.join(AUTOMATIONS_DIR, filename)
        if not os.path.exists(path): return web.json_response({"error": "Not found"}, status=404)
        
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/mini/bridge_image")
async def bridge_image(request):
    try:
        data = await request.json()
        filename = data.get("filename")
        subfolder = data.get("subfolder", "")
        folder_type = data.get("type", "output")
        
        if not filename: return web.json_response({"error": "No filename"}, status=400)

        # Resolve Source
        if folder_type == "output":
            src_dir = folder_paths.get_output_directory()
        else:
            src_dir = folder_paths.get_temp_directory()
            
        src_path = os.path.join(src_dir, subfolder, filename)
        
        # Resolve Dest (Input)
        input_dir = folder_paths.get_input_directory()
        dest_path = os.path.join(input_dir, filename) 
        
        # Handle collision with timestamp
        if os.path.exists(dest_path):
            base, ext = os.path.splitext(filename)
            dest_path = os.path.join(input_dir, f"{base}_{int(time.time())}{ext}")
            
        if os.path.exists(src_path):
            shutil.copy(src_path, dest_path)
            print(f"[ComfyMini] Bridged image {filename} to Input folder.")
            return web.json_response({"filename": os.path.basename(dest_path)})
            
        return web.json_response({"error": "Source file not found"}, status=404)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# --- FAVORITES (server-side, shared across devices via workflow library) ---
FAVORITES_FILE = os.path.join(WEBROOT, "favorites.json")

@server.PromptServer.instance.routes.get("/mini/load_favorites")
async def load_favorites(request):
    try:
        if not os.path.exists(FAVORITES_FILE): return web.json_response([])
        with open(FAVORITES_FILE, 'r', encoding='utf-8') as f: return web.json_response(json.load(f))
    except Exception as e:
        print(f"[ComfyMini] Error loading favorites: {e}")
        return web.json_response([])

@server.PromptServer.instance.routes.post("/mini/save_favorites")
async def save_favorites(request):
    try:
        data = await request.json()
        list_data = data.get("list", [])
        with open(FAVORITES_FILE, 'w', encoding='utf-8') as f: json.dump(list_data, f)
        return web.json_response({"status": "success"})
    except Exception as e:
        print(f"[ComfyMini] Error saving favorites: {e}")
        return web.json_response({"error": str(e)}, status=500)


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
