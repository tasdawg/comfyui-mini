import os
import json
import shutil
import server
import time
from aiohttp import web
import folder_paths

# 1. Setup Directories
current_dir = os.path.dirname(os.path.realpath(__file__))
WEBROOT = os.path.join(current_dir, "web")
WORKFLOWS_DIR = os.path.join(WEBROOT, "workflows")
META_DIR = os.path.join(WORKFLOWS_DIR, "meta") 
BACKUPS_DIR = os.path.join(WEBROOT, "backups")
AUTOMATIONS_DIR = os.path.join(WEBROOT, "automations") 
OUTPUT_DIR = folder_paths.get_output_directory()

for d in [WORKFLOWS_DIR, META_DIR, BACKUPS_DIR, AUTOMATIONS_DIR]:
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

@server.PromptServer.instance.routes.get("/mini/files")
async def list_files(request):
    subfolder = request.query.get("path", "")
    target_path = os.path.abspath(os.path.join(OUTPUT_DIR, subfolder))
    if not target_path.startswith(os.path.abspath(OUTPUT_DIR)): return web.json_response({"error": "Invalid"}, status=403)
    if not os.path.exists(target_path): return web.json_response({"path": subfolder, "folders": [], "images": []})
    
    folders = []; images = []
    try:
        for item in os.listdir(target_path):
            if item.startswith('.'): continue
            full_path = os.path.join(target_path, item)
            if os.path.isdir(full_path): folders.append(item)
            elif item.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
                images.append({ "filename": item, "subfolder": subfolder, "type": "output" })
        folders.sort(); images.sort(key=lambda x: x['filename'], reverse=True)
        return web.json_response({"path": subfolder, "folders": folders, "images": images})
    except Exception as e: return web.json_response({"error": str(e)}, status=500)

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

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
