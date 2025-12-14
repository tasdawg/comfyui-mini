// --- APP STATE ---
const els = {
    controls: document.getElementById('controls-container'),
    hiddenList: document.getElementById('hidden-list'),
    hiddenContainer: document.getElementById('hidden-container'),
    genBtn: document.getElementById('generate-btn'),
    stopBtn: document.getElementById('interrupt-btn'),
    editBtn: document.getElementById('edit-btn'),
    saveLayoutBtn: document.getElementById('save-layout-btn'),
    result: document.getElementById('result-image'),
    loading: document.getElementById('loading-overlay'),
    progress: document.getElementById('progress-text'),
    dot: document.getElementById('status-dot'),
    empty: document.getElementById('empty-state'),
    header: document.getElementById('header-title'),
    modal: document.getElementById('image-modal'),
    modalImg: document.getElementById('modal-image'),
    closeModal: document.getElementById('close-modal')
};

let loadedWorkflow = {};
let loadedLayout = []; 
let objectInfo = {};
let fooocusStyles = [];
let clientId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
let socket = null;
let currentPromptId = null;

// --- NEW STATE FOR GROUPS ---
let isEditMode = false;
let isGroupingMode = false;     // True when we are currently selecting inputs
let showGroupsOnly = false;     // True when "Groups Only" filter is active
let customGroups = [];          // Array of { id, title, inputs: [{nodeId, key}] }
let activeGroupId = null;       // ID of the group currently being built

// --- API HELPERS ---
export async function safeFetch(url, fallbackValue) {
    try {
        const res = await fetch(url);
        if (!res.ok) return fallbackValue;
        return await res.json();
    } catch (e) { return fallbackValue; }
}

async function saveGroups() {
    console.log("Saving groups...");
    try {
        let currentName = "workflow";
        if (loadedWorkflow && loadedWorkflow["_mini_origin"]) {
            currentName = loadedWorkflow["_mini_origin"];
        }

        const res = await fetch('/mini/save_groups', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                filename: currentName, 
                groups: customGroups 
            }) 
        });

        if (!res.ok) throw new Error(`Server error ${res.status}`);
        console.log("Groups saved for:", currentName);
        
    } catch(e) { 
        console.error("Failed to save groups:", e);
        alert("Error saving groups: " + e.message);
    }
}

function renameGroup(id) {
    const group = customGroups.find(g => g.id === id);
    if (!group) return;

    const newName = prompt("Enter new name for this group:", group.title);
    if (newName && newName.trim().length > 0) {
        group.title = newName.trim();
        renderControls();
    }
}

export async function getObjectInfo(nodeClass) {
    if (objectInfo[nodeClass]) return objectInfo[nodeClass];
    try {
        const res = await fetch(`/object_info/${nodeClass}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data[nodeClass]) {
            objectInfo[nodeClass] = data[nodeClass];
            return data[nodeClass];
        }
        return null;
    } catch (e) { return null; }
}

async function checkBackendForNodes() {
    if (!loadedWorkflow) return;
    const neededTypes = new Set();
    for (const [id, node] of Object.entries(loadedWorkflow)) {
        if (node && node.class_type) {
            neededTypes.add(node.class_type);
        } else {
            console.warn(`[DEBUG] Node ${id} has no class_type!`, node);
        }
    }
    
    const promises = [];
    console.log(`[DEBUG] Checking backend for ${neededTypes.size} unique node types...`);
    
    for (const type of neededTypes) {
        if (!objectInfo[type]) {
            console.log(`[DEBUG] Fetching info for missing type: ${type}`);
            promises.push(getObjectInfo(type));
        }
    }
    if (promises.length > 0) await Promise.all(promises);
    
    // Final check
    neededTypes.forEach(type => {
        if(!objectInfo[type]) console.error(`[DEBUG] CRITICAL: Backend has no info for node type '${type}'. This node will likely fail to render.`);
    });
}

async function init() {
    connectWS();
    try {
        const infoRes = await fetch('/object_info');
        if(infoRes.ok) objectInfo = await infoRes.json();

        // --- 1. DETERMINE SOURCE ---
        const urlParams = new URLSearchParams(window.location.search);
        const specificFile = urlParams.get('file');

        let wfUrl = '/mini/workflow.json?t=' + Date.now(); // Default: Resume session
        let groupsUrl = '/mini/load_groups?t=' + Date.now();
        
        if (specificFile) {
            console.log(`[Init] Loading specific workflow: ${specificFile}`);
            // Load the specific file content directly from the Workflows folder
            wfUrl = `/mini/get_workflow?filename=${encodeURIComponent(specificFile)}&t=${Date.now()}`;
            // Load groups for this specific file
            groupsUrl = `/mini/load_groups?filename=${encodeURIComponent(specificFile)}&t=${Date.now()}`;
        }

        // --- 2. FETCH DATA ---
        const wfRes = await fetch(wfUrl, { headers: { 'Cache-Control': 'no-cache' } });
        if(wfRes.ok) loadedWorkflow = await wfRes.json();
        if (!loadedWorkflow || typeof loadedWorkflow !== 'object') loadedWorkflow = {};

        // Debug Log
        console.log(`[DEBUG] Loaded ${specificFile || "Session"} keys:`, Object.keys(loadedWorkflow));

        await checkBackendForNodes();

        // Load config files
        loadedLayout = await safeFetch('/mini/layout.json?t=' + Date.now(), []);
        customGroups = await safeFetch(groupsUrl, []); 
        fooocusStyles = await safeFetch('/mini/fooocus_styles.json', []);
        
        // Update Header
        if (els.header) {
            // Use filename from URL if available, otherwise try to guess from SaveImage
            if (specificFile) {
                els.header.innerText = specificFile.replace('.json', '').toUpperCase();
            } else {
                const nodes = Object.values(loadedWorkflow);
                const saveNode = nodes.find(n => n && n.class_type === "SaveImage");
                if(saveNode && saveNode.inputs && saveNode.inputs.filename_prefix) {
                    els.header.innerText = saveNode.inputs.filename_prefix.split('/')[0].toUpperCase();
                }
            }
        }
        
        await renderControls();
        
        // IMPORTANT: If we loaded a specific file, we should update the "Active Session" 
        // silently in the background so "Resume" works next time.
        if (specificFile) {
            // We set a flag so the next Save/Run knows where this came from
            if (!loadedWorkflow._mini_origin) loadedWorkflow._mini_origin = specificFile;
            // Trigger a silent save to overwrite workflow.json with what we just loaded
            saveGroups(); 
            fetch('/mini/save_workflow', { 
                method: 'POST', 
                body: JSON.stringify(loadedWorkflow) 
            });
        }

    } catch(e) { 
        console.error(e); 
        alert("Initialization Error: " + e.message); 
    }
    
    if(els.genBtn) els.genBtn.onclick = run;
    if(els.stopBtn) els.stopBtn.onclick = interrupt;
    if(els.editBtn) els.editBtn.onclick = toggleEditMode;
    if(els.saveLayoutBtn) els.saveLayoutBtn.onclick = saveLayout;
    setupMainPageModal();
}

// --- UPLOAD HELPER (EXPORTED & DECOUPLED) ---
export function handleImageUpload(nodeId, inputKey, statusElement, inputElement, onSuccessCallback) {
    // 1. Create invisible file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    
    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 2. Prepare Upload
        const formData = new FormData();
        formData.append('image', file);
        formData.append('overwrite', 'true');

        // Visuals: Grey text, Loading state
        statusElement.innerText = "0%";
        statusElement.className = "text-[9px] font-bold text-zinc-500 ml-2";
        statusElement.classList.remove('hidden'); // Ensure visible
        
        inputElement.classList.remove('border-orange-500'); // Reset
        inputElement.classList.add('opacity-50', 'cursor-not-allowed');
        inputElement.disabled = true;

        // 3. XHR Upload (for Progress events)
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload/image', true);

        xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
                const percent = Math.round((ev.loaded / ev.total) * 100);
                statusElement.innerText = `${percent}%`;
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                const filename = data.name; 

                // 4. Success State & Dropdown Handling
                if (inputElement.tagName === 'SELECT') {
                    // Check if option exists, if not, add it
                    let exists = Array.from(inputElement.options).some(o => o.value === filename);
                    if (!exists) {
                        const opt = document.createElement('option');
                        opt.value = filename;
                        opt.innerText = filename;
                        inputElement.appendChild(opt);
                    }
                }
                
                inputElement.value = filename;
                
                // Update State Callback
                if (onSuccessCallback) {
                    onSuccessCallback(filename);
                } else if (loadedWorkflow[nodeId] && loadedWorkflow[nodeId].inputs) {
                    // Fallback for app.js legacy calls if callback not provided
                    loadedWorkflow[nodeId].inputs[inputKey] = filename;
                }

                // Visuals: Orange Border, Done Text
                inputElement.classList.remove('opacity-50', 'cursor-not-allowed');
                inputElement.disabled = false;
                inputElement.classList.add('border-orange-500', 'text-orange-200'); 
                
                statusElement.innerText = "DONE";
                statusElement.className = "text-[9px] font-bold text-orange-500 ml-2";
                setTimeout(() => statusElement.innerText = "", 2000); 

            } else {
                alert("Upload Failed");
                statusElement.innerText = "ERR";
                statusElement.className = "text-[9px] font-bold text-red-500 ml-2";
                inputElement.classList.remove('opacity-50', 'cursor-not-allowed');
                inputElement.disabled = false;
            }
        };
        
        xhr.send(formData);
    };

    fileInput.click();
}

// --- MODAL HELPERS (EXPORTED) ---

export function openModal(src) {
    if(!els.modal || !els.modalImg) return;
    els.modalImg.src = src;
    els.modal.classList.remove('hidden');
    setTimeout(() => els.modal.classList.remove('opacity-0'), 10);
}

export function setupModalListeners() {
    if (!els.modal || !els.closeModal) return;
    const hide = () => { 
        els.modal.classList.add('opacity-0'); 
        setTimeout(() => els.modal.classList.add('hidden'), 300); 
    };
    els.closeModal.onclick = hide;
    els.modal.onclick = (e) => { if(e.target === els.modal) hide(); };
}

function setupMainPageModal() {
    // Only runs if on the main page (checked via els.result)
    if (!els.result) return;

    setupModalListeners();
    
    els.result.onclick = () => {
        if (!els.result.src.endsWith('html') && !els.result.classList.contains('opacity-50')) {
            openModal(els.result.src);
        }
    };
}

// --- WEBSOCKET & HANDLERS ---
function connectWS() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${window.location.host}/ws?clientId=${clientId}`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => { if(els.dot) { els.dot.classList.replace('bg-red-500', 'bg-green-500'); els.dot.classList.add('shadow-green-500'); } };
    socket.onclose = () => { if(els.dot) { els.dot.classList.replace('bg-green-500', 'bg-red-500'); els.dot.classList.remove('shadow-green-500'); } setTimeout(connectWS, 2000); };
    socket.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
            const blob = new Blob([e.data.slice(8)], { type: 'image/jpeg' });
            if(els.result) {
                els.result.src = URL.createObjectURL(blob);
                els.result.classList.remove('opacity-50');
                if(els.empty) els.empty.classList.add('hidden');
            }
            return;
        }
        try { handleMsg(JSON.parse(e.data)); } catch (e) {}
    };
}

// --- UPDATED: Universal Dynamic Updater & Auto-Saver ---
async function updateNodeDisplay(nodeId, newData) {
    // 1. FIND ALL RELATED INPUTS
    // We search for ANY input in the DOM that belongs to this node.
    // This covers inputs inside Groups (data-node) AND inputs in Main Cards (parent data-id).
    const allRelatedInputs = Array.from(document.querySelectorAll(
        `input[data-node="${nodeId}"], textarea[data-node="${nodeId}"], select[data-node="${nodeId}"],
         .compact-card[data-id="${nodeId}"] input, .compact-card[data-id="${nodeId}"] textarea, .compact-card[data-id="${nodeId}"] select`
    ));

    if (allRelatedInputs.length === 0) {
        // Node is not currently visible on screen. 
        // We update the internal memory (loadedWorkflow) blindly so it saves correctly.
        updateInternalStateOnly(nodeId, newData);
        return;
    }

    let hasChanges = false;

    for (const [outKey, outValue] of Object.entries(newData)) {
        if (outKey === 'images') continue;

        let valToSet = Array.isArray(outValue) ? outValue[0] : outValue;
        if (typeof valToSet === 'object' && valToSet !== null) continue;

        // --- 2. RESOLVE MAPPING (Heuristics) ---
        // We need to figure out which 'data-key' (e.g. "text_0") matches this output (e.g. "text")
        let matchedKey = null;

        // A. Try Exact Match First
        if (allRelatedInputs.some(el => el.dataset.key === outKey)) {
            matchedKey = outKey;
        }
        // B. String Fallbacks (for ShowText nodes)
        else if (typeof valToSet === 'string') {
            // Priority: "text_0" -> Any TEXTAREA -> Any text input with "text/string" in name
            if (allRelatedInputs.some(el => el.dataset.key === 'text_0')) matchedKey = 'text_0';
            else {
                const textArea = allRelatedInputs.find(el => el.tagName === 'TEXTAREA');
                if (textArea) matchedKey = textArea.dataset.key;
            }
        }
        // C. Number Fallbacks (for Seeds)
        else if (typeof valToSet === 'number') {
            if (allRelatedInputs.some(el => el.dataset.key === 'seed')) matchedKey = 'seed';
            else {
                const numInput = allRelatedInputs.find(el => el.type === 'number');
                if (numInput) matchedKey = numInput.dataset.key;
            }
        }

        // --- 3. EXECUTE UPDATE ---
        if (matchedKey) {
            console.log(`[UI UPDATE] Node ${nodeId}: '${outKey}' -> '${matchedKey}' =`, valToSet);

            // Find all instances of this specific key (Group copies + Main copy)
            const targets = allRelatedInputs.filter(el => el.dataset.key === matchedKey);

            targets.forEach(el => {
                // Only update if value matches (handling loose equality for numbers)
                if (el.value != valToSet) {
                    el.value = valToSet;
                    
                    // Visual Flash
                    el.classList.add('bg-blue-900/50', 'text-white');
                    setTimeout(() => el.classList.remove('bg-blue-900/50', 'text-white'), 1000);
                }
            });

            // Update Internal Memory
            if (loadedWorkflow[nodeId] && loadedWorkflow[nodeId].inputs) {
                if (loadedWorkflow[nodeId].inputs[matchedKey] !== valToSet) {
                    loadedWorkflow[nodeId].inputs[matchedKey] = valToSet;
                    hasChanges = true;
                }
            }
        }
    }

    // --- 4. PERSIST CHANGES (Auto-Save) ---
    if (hasChanges) {
        console.log("[Auto-Save] Saving dynamic updates...");
        try {
            await fetch('/mini/save_workflow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(loadedWorkflow)
            });
        } catch(e) { 
            console.error("Failed to auto-save dynamic updates", e); 
        }
    }
}

// Fallback helper for when nodes are hidden
function updateInternalStateOnly(nodeId, newData) {
    if (!loadedWorkflow[nodeId] || !loadedWorkflow[nodeId].inputs) return;
    
    for (const [outKey, outValue] of Object.entries(newData)) {
        if (outKey === 'images') continue;
        let val = Array.isArray(outValue) ? outValue[0] : outValue;
        if (typeof val === 'object') continue;

        // Blind guess mapping
        if (outKey === 'text' && loadedWorkflow[nodeId].inputs['text_0'] !== undefined) {
            loadedWorkflow[nodeId].inputs['text_0'] = val;
        } else if (loadedWorkflow[nodeId].inputs[outKey] !== undefined) {
            loadedWorkflow[nodeId].inputs[outKey] = val;
        }
    }
}

async function handleMsg(msg) {
    // FILTER: Block noisy messages
    const noisyTypes = ['kaytool.resources', 'crystools.monitor'];
    if (noisyTypes.includes(msg.type)) return;

    // DEBUG: Log everything else
    console.log("[WS DEBUG]", msg.type, msg.data);

    if (msg.type === 'status' && msg.data.status.exec_info.queue_remaining === 0) {
        // EXECUTION FINISHED
        if(els.loading) els.loading.classList.add('hidden');
        if(els.genBtn) els.genBtn.classList.remove('hidden');
        if(els.stopBtn) els.stopBtn.classList.add('hidden');
        
        // --- TRIGGER HISTORY FETCH ---
        if (currentPromptId) {
            console.log("[DEBUG] Run finished. Fetching history for:", currentPromptId);
            await updateUIFromHistory(currentPromptId);
        }

    } else if (msg.type === 'progress') {
        if(els.progress) els.progress.innerText = `${Math.round((msg.data.value/msg.data.max)*100)}%`;
        
    } else if (msg.type === 'executed') {
        // 1. Handle Images
        if (msg.data.output.images) {
            const img = msg.data.output.images[0];
            if(els.result) {
                els.result.src = `/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}&t=${Date.now()}`;
                els.result.classList.remove('opacity-50');
                if(els.empty) els.empty.classList.add('hidden');
            }
        }

        // 2. Handle Real-time Text Updates (Show Text, etc.)
        const updates = msg.data.ui || msg.data.output;
        if (updates) {
            updateNodeDisplay(msg.data.node, updates);
        }
    }
}

async function updateUIFromHistory(pid) {
    try {
        const res = await fetch(`/history/${pid}`);
        if (!res.ok) return;

        const data = await res.json();
        
        // Structure: { "prompt_id": { "outputs": { "3": { "text": ["..."] } } } }
        const runData = data[pid];
        
        if (!runData || !runData.outputs) {
            console.log("[DEBUG] History fetched, but no 'outputs' found for", pid);
            return;
        }

        console.log("[DEBUG] History Outputs Found:", runData.outputs);

        // Iterate over every node that produced an output
        for (const [nodeId, outputs] of Object.entries(runData.outputs)) {
            updateNodeDisplay(nodeId, outputs);
        }
    } catch(e) {
        console.error("Failed to update from history:", e);
    }
}

function getSortedNodes() {
    console.group("getSortedNodes Debug"); // Groups logs in console
    let nodeIds = Object.keys(loadedWorkflow);
    let displayList = [];
    
    // 1. Process Saved Layout
    loadedLayout.forEach(item => {
        const matchId = nodeIds.find(id => String(id) === String(item.id));
        if (matchId) {
            // console.log(`[DEBUG] Found layout match for Node ${matchId}`);
            displayList.push({ id: matchId, visible: item.visible, height: item.height || 'auto' });
            nodeIds = nodeIds.filter(id => id !== matchId);
        }
    });

    // 2. Process Remaining Nodes
    nodeIds.forEach(id => {
        if (id.startsWith('_')) {
            console.log(`[DEBUG] Skipping hidden meta-node: ${id}`);
            return; 
        }
        
        const node = loadedWorkflow[id];
        if (!node || typeof node !== 'object') {
            console.warn(`[DEBUG] Invalid node structure for ID ${id}`, node);
            return; 
        }

        const type = node.class_type || "Unknown";
        
        // Define skipped types
        const skippedTypes = ['Reroute', 'PrimitiveNode', 'Note', 'Griptape Combine: Merge Texts', 'ShowText|pysssss'];
        
        if (skippedTypes.includes(type)) {
            console.log(`[DEBUG] Auto-hiding known utility node: ${id} (${type})`);
        }

        const autoVisible = !skippedTypes.includes(type);
        
        console.log(`[DEBUG] Adding new node to list: ${id} (${type})`);
        displayList.push({ id: id, visible: autoVisible, height: 'auto' });
    });

    console.log(`[DEBUG] Final Display List Count: ${displayList.length}`);
    console.groupEnd();
    return displayList;
}

export function createInputDOM(node, key, val, def, isGroupNode = false, groupInputRef = null) {
    let input;
    let isTextArea = false;
    let isDropdown = false;
    let options = null;

    // --- 1. DETERMINE TYPE ---
    let inputDef = null;
    if (def && def.input) {
        if (def.input.required && def.input.required[key]) inputDef = def.input.required[key];
        else if (def.input.optional && def.input.optional[key]) inputDef = def.input.optional[key];
    }
    if (inputDef) {
        if (Array.isArray(inputDef) && inputDef[0] === "COMBO" && inputDef[1] && inputDef[1].options) {
            options = inputDef[1].options;
        } else if (Array.isArray(inputDef) && inputDef.length > 0 && typeof inputDef[0] === 'string' && 
                !["STRING", "INT", "FLOAT", "BOOLEAN", "IMAGE", "MODEL", "VAE", "CLIP", "CONDITIONING", "LATENT"].includes(inputDef[0])) {
             options = inputDef;
        } else if (Array.isArray(inputDef[0])) {
            options = inputDef[0];
        }
    }

    const isString = typeof val === 'string' && (val.length > 30 || key === 'text' || key.includes('prompt') || key === 'STRING');
    if (options) isDropdown = true;
    if (isString && !isDropdown) isTextArea = true;

    // --- 2. CREATE DOM ---
    if (isDropdown) {
        input = document.createElement('select');
        input.className = 'w-full input-dark rounded p-1.5 text-[10px] font-sans outline-none appearance-none cursor-pointer';
        input.style.backgroundImage = `url('data:image/svg+xml;charset=US-ASCII,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="%23555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>')`;
        input.style.backgroundRepeat = 'no-repeat';
        input.style.backgroundPosition = 'right 8px center';
        
        if (options) {
            options.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o; 
                opt.innerText = o;
                if (o === val) opt.selected = true;
                input.appendChild(opt);
            });
        }
        input.onchange = (e) => { 
            node.inputs[key] = e.target.value; 
            if(isGroupNode) renderControls(); 
        };
    } 
    else if (isTextArea) {
        const container = document.createElement('div');
        container.className = "relative w-full h-full"; 

        input = document.createElement('textarea');
        input.className = 'w-full input-dark rounded p-1.5 text-[10px] font-sans outline-none resize-none h-full'; 
        input.value = val;
        
        if (isGroupNode && groupInputRef && groupInputRef.height) {
            input.style.height = `${groupInputRef.height}px`;
        }

        input.onchange = (e) => { node.inputs[key] = e.target.value; };
        container.appendChild(input);

        // Edit Mode Resize Handle
        if (isEditMode) {
             const resizeHandle = document.createElement('div');
             resizeHandle.className = "absolute bottom-0 right-0 w-3 h-3 bg-zinc-600/50 cursor-se-resize rounded-tl hover:bg-blue-500 z-10";
             let startY = 0; let startH = 0; let startCardH = 0; let card = null;
             const onMove = (e) => {
                const dy = e.clientY - startY;
                const newH = Math.max(40, startH + dy);
                input.style.height = `${newH}px`;
                if(isGroupNode && groupInputRef) { groupInputRef.height = newH; } 
                else if (!isGroupNode && card) { const newCardH = Math.max(100, startCardH + dy); card.style.height = `${newCardH}px`; }
            };
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
            resizeHandle.onmousedown = (e) => {
                e.stopPropagation(); startY = e.clientY; startH = input.offsetHeight;
                if (!isGroupNode) { card = container.closest('.compact-card'); if (card) startCardH = card.offsetHeight; }
                window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
            };
            container.appendChild(resizeHandle);
        }
        
        input.dataset.key = key; // Tag for updates
        return { dom: container, isTextArea, isDropdown };
    } 
    else {
        input = document.createElement('input');
        input.type = typeof val === 'number' ? 'number' : 'text';
        input.className = 'w-full input-dark rounded p-1.5 text-[10px] font-sans outline-none';
        input.value = val;
        if (typeof val === 'number') input.step = "any";
        input.onchange = (e) => { 
            let v = e.target.value;
            if (typeof val === 'number') v = Number(v);
            node.inputs[key] = v; 
            if(isGroupNode) renderControls();
        };
    }
    
    // --- FIXED: TAG ALL TYPES CORRECTLY ---
    if(input) {
        input.dataset.key = key; 
        if (isGroupNode && groupInputRef) {
            input.dataset.node = groupInputRef.nodeId;
        }
    }

    return { dom: input, isTextArea, isDropdown };
}

async function renderControls() {
    if (!els.controls) return;
    const scrollTop = els.controls.scrollTop;
    els.controls.innerHTML = '';
    
    // --- HEADER ---
    const controlsHeader = document.createElement('div');
    controlsHeader.className = "flex justify-between items-center mb-4 px-1";
    const filterContainer = document.createElement('label');
    filterContainer.className = "flex items-center gap-2 text-[10px] text-zinc-400 font-bold uppercase cursor-pointer select-none";
    filterContainer.innerHTML = `<input type="checkbox" class="accent-blue-500" ${showGroupsOnly ? 'checked' : ''}> Groups Only`;
    filterContainer.querySelector('input').onchange = (e) => { showGroupsOnly = e.target.checked; renderControls(); };
    controlsHeader.appendChild(filterContainer);

    if (isEditMode) {
        const createBtn = document.createElement('button');
        createBtn.className = isGroupingMode ? "bg-green-600 text-white px-3 py-1 rounded text-[10px] font-bold uppercase animate-pulse" : "bg-blue-600 text-white px-3 py-1 rounded text-[10px] font-bold uppercase";
        createBtn.innerText = isGroupingMode ? "Done Grouping" : "Create Group";
        createBtn.onclick = isGroupingMode ? stopGrouping : startNewGroup;
        controlsHeader.appendChild(createBtn);
    }
    els.controls.appendChild(controlsHeader);

    // --- 1. RENDER GROUPS ---
    for (const group of customGroups) {
        const card = document.createElement('div');
        const isActive = isGroupingMode && activeGroupId === group.id;
        const editStyle = isEditMode 
            ? (isActive ? 'border-dashed border-green-500 ring-1 ring-green-500' : 'border-dashed border-orange-500/50') 
            : 'border-orange-500';
        
        card.className = `compact-card relative z-10 mb-4 flex flex-col overflow-hidden min-h-[100px] border-2 ${editStyle}`;
        card.style.height = 'auto';

        const header = document.createElement('div');
        header.className = 'px-3 py-1.5 bg-orange-900/20 border-b border-orange-500/30 flex justify-between items-center shrink-0';
        const titleDiv = document.createElement('div');
        titleDiv.className = "flex items-center gap-2 min-w-0 flex-1";
        
        // Title HTML
        titleDiv.innerHTML = `<span class="text-orange-400 text-[10px]">★</span><span class="text-[10px] font-bold text-orange-200 uppercase tracking-wider truncate cursor-default">${group.title}</span>`;
        
        // --- GROUP UPLOAD ICON CHECK ---
        const imageInputRef = group.inputs.find(ref => {
            const n = loadedWorkflow[ref.nodeId];
            return n && (n.class_type === "LoadImage" || n.class_type === "LoadImageMask");
        });

        if (imageInputRef && !isEditMode) {
            const uploadBtn = document.createElement('button');
            uploadBtn.className = "text-zinc-400 hover:text-orange-400 transition-colors ml-2";
            uploadBtn.title = "Upload Image for this Group";
            uploadBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>`;
            
            const progressSpan = document.createElement('span');
            progressSpan.className = "text-[9px] font-bold text-zinc-500 ml-2 hidden";

            uploadBtn.onclick = () => {
                const inputEl = card.querySelector(`input[data-node="${imageInputRef.nodeId}"][data-key="${imageInputRef.key}"], select[data-node="${imageInputRef.nodeId}"][data-key="${imageInputRef.key}"]`);
                if(inputEl) {
                    // Uses default legacy behavior (no callback)
                    handleImageUpload(imageInputRef.nodeId, imageInputRef.key, progressSpan, inputEl);
                }
                else console.error("Could not find input element for upload!");
            };
            
            titleDiv.appendChild(uploadBtn);
            titleDiv.appendChild(progressSpan);
        }

        if (isEditMode) {
            const renameBtn = document.createElement('button');
            renameBtn.innerText = "✎"; renameBtn.className = "text-zinc-500 hover:text-white text-[10px] px-1 ml-1";
            renameBtn.onclick = () => renameGroup(group.id);
            titleDiv.appendChild(renameBtn);

            if (!isGroupingMode) {
                const addInputsBtn = document.createElement('button');
                addInputsBtn.innerText = "+"; 
                addInputsBtn.className = "text-green-500 hover:text-white font-bold text-[12px] px-1 ml-1";
                addInputsBtn.onclick = () => editExistingGroup(group.id);
                titleDiv.appendChild(addInputsBtn);
            }
        }
        header.appendChild(titleDiv);
        
        if (isEditMode) {
            const delBtn = document.createElement('button');
            delBtn.innerText = "×"; delBtn.className = "text-orange-400 font-bold hover:text-red-400 px-2";
            delBtn.onclick = () => deleteGroup(group.id);
            header.appendChild(delBtn);
        }
        card.appendChild(header);

        const body = document.createElement('div');
        body.className = 'p-3 space-y-3 flex-1 overflow-y-auto custom-scrollbar';
        
        if (group.inputs.length === 0) {
            body.innerHTML = '<div class="text-[9px] text-zinc-600 italic text-center py-2">No inputs selected.</div>';
        }

        for (let i = 0; i < group.inputs.length; i++) {
            const inputRef = group.inputs[i];
            const originalNode = loadedWorkflow[inputRef.nodeId];
            if (!originalNode) continue;
            
            if (inputRef.key === 'select_styles') {
                const wrap = createStyleSelector(originalNode, inputRef.key, null, fooocusStyles);
                if (isEditMode) {
                    const moveContainer = document.createElement('div');
                    moveContainer.className = "flex justify-end gap-1 mb-1";
                    moveContainer.innerHTML = `<button class="text-[8px] text-zinc-500 hover:text-white" onclick="moveGroupInput('${group.id}', ${i}, -1)">▲</button><button class="text-[8px] text-zinc-500 hover:text-white" onclick="moveGroupInput('${group.id}', ${i}, 1)">▼</button>`;
                    wrap.prepend(moveContainer);
                }
                body.appendChild(wrap);
                continue;
            }

            let def = objectInfo[originalNode.class_type] || await getObjectInfo(originalNode.class_type);
            
            const groupWrap = document.createElement('div');
            groupWrap.className = 'space-y-1';
            
            const { dom, isTextArea } = createInputDOM(
                originalNode, 
                inputRef.key, 
                originalNode.inputs[inputRef.key], 
                def, 
                true, 
                inputRef
            );

            // TAG INPUT for Group Upload finding
            if (dom.tagName === 'INPUT') {
                dom.dataset.node = inputRef.nodeId;
                dom.dataset.key = inputRef.key;
            }
            
            const nodeTitle = originalNode._meta?.title || originalNode.class_type;
            const labelRow = document.createElement('div');
            labelRow.className = "flex justify-between items-baseline";
            
            let leftPart = `
                <div class="flex flex-col">
                    <label class="block text-[9px] font-medium text-zinc-300 uppercase tracking-wider">${inputRef.key.replace(/_/g,' ')}</label>
                    <span class="text-[8px] text-zinc-600 truncate max-w-[100px]">${nodeTitle}</span>
                </div>
            `;
            
            let rightPart = isEditMode ? `
                <div class="flex gap-1 ml-2">
                    <button class="text-[9px] text-zinc-500 hover:text-white px-1" onclick="moveGroupInput('${group.id}', ${i}, -1)">▲</button>
                    <button class="text-[9px] text-zinc-500 hover:text-white px-1" onclick="moveGroupInput('${group.id}', ${i}, 1)">▼</button>
                </div>
            ` : "";
            
            labelRow.innerHTML = leftPart + rightPart;
            groupWrap.appendChild(labelRow);
            groupWrap.appendChild(dom);
            if(isTextArea) groupWrap.className = "flex flex-col h-auto"; 
            body.appendChild(groupWrap);
        }
        card.appendChild(body);
        els.controls.appendChild(card);
    }

    // --- 2. RENDER NORMAL NODES ---
    if (!showGroupsOnly) {
        if (customGroups.length > 0) { const div = document.createElement('div'); div.className = "h-px bg-zinc-800 my-4 mx-2"; els.controls.appendChild(div); }
        
        const displayList = getSortedNodes();
        for (let index = 0; index < displayList.length; index++) {
            const item = displayList[index];
            const node = loadedWorkflow[item.id];
            if (!node || !node.class_type) continue;
            if (!item.visible && !isEditMode) continue;

            let def = objectInfo[node.class_type] || await getObjectInfo(node.class_type);
            
            // Collect Inputs
            let validInputs = [];
            let hasTextArea = false; 
            if (node.inputs) {
                for (let [key, val] of Object.entries(node.inputs)) {
                    if (Array.isArray(val) || (typeof val === 'object' && val !== null && !val.__value__)) continue;
                    const isString = typeof val === 'string' && (val.length > 30 || key === 'text' || key.includes('prompt') || key === 'STRING');
                    let isDropdown = false;
                    let inputDef = def?.input?.required?.[key] || def?.input?.optional?.[key];
                    if (inputDef && Array.isArray(inputDef)) {
                        if ((inputDef[0] === "COMBO" && inputDef[1]?.options) || 
                            (inputDef.every(i => typeof i === 'string') && inputDef.length > 0 && !["STRING", "INT"].includes(inputDef[0]))) {
                            isDropdown = true;
                        }
                    }
                    if (isString && !isDropdown) hasTextArea = true;
                    validInputs.push({ key, val, isTextArea: (isString && !isDropdown), isDropdown });
                }
            }
            if (validInputs.length === 0) continue;

            const card = document.createElement('div');
            card.dataset.id = item.id; 
            const visibilityStyle = (!item.visible && isEditMode) ? 'opacity-40 grayscale border-red-900/30' : '';
            const editStyle = isEditMode ? 'border-dashed border-zinc-600' : '';
            card.className = `compact-card relative z-0 mb-2 flex flex-col overflow-hidden min-h-[120px] ${editStyle} ${visibilityStyle}`;
            card.style.height = (item.height && item.height !== 'auto') ? `${item.height}px` : 'auto';

            const header = document.createElement('div');
            header.className = 'px-3 py-1.5 bg-white/5 border-b border-[#27272a] flex justify-between items-center shrink-0';
            const title = node._meta?.title || node.class_type;
            
            const titleDiv = document.createElement('div');
            titleDiv.className = "flex items-center";
            titleDiv.innerHTML = `<span class="text-[10px] font-bold text-zinc-300 uppercase tracking-wider truncate mr-2">${(!item.visible && isEditMode) ? `(HIDDEN) ${title}` : title}</span>`;

            // --- NODE UPLOAD ICON CHECK ---
            if (node.class_type === "LoadImage" || node.class_type === "LoadImageMask") {
                if (!isEditMode) {
                    const uploadBtn = document.createElement('button');
                    uploadBtn.className = "text-zinc-500 hover:text-blue-400 transition-colors";
                    uploadBtn.title = "Upload Image";
                    uploadBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>`;
                    
                    const progressSpan = document.createElement('span');
                    progressSpan.className = "text-[9px] font-bold text-zinc-500 ml-2 hidden";

                    uploadBtn.onclick = () => {
                        const inputEl = card.querySelector('input[data-key="image"], select[data-key="image"]');
                        if(inputEl) handleImageUpload(item.id, 'image', progressSpan, inputEl);
                        else console.error("Could not find input element for upload!");
                    };
                    titleDiv.appendChild(uploadBtn);
                    titleDiv.appendChild(progressSpan);
                }
            }
            header.appendChild(titleDiv);

            if (isEditMode) {
                const controls = document.createElement('div'); controls.className = "flex gap-1 shrink-0";
                controls.innerHTML = `<button class="edit-btn" onclick="moveNode(${index}, -1)">▲</button><button class="edit-btn" onclick="moveNode(${index}, 1)">▼</button><button class="edit-btn ${item.visible ? 'text-red-400' : 'text-green-400 font-bold'}" onclick="setVisibility('${item.id}', ${!item.visible})">${item.visible ? 'Hide' : 'Show'}</button>`;
                header.appendChild(controls);
            }
            card.appendChild(header);

            const body = document.createElement('div');
            body.className = hasTextArea ? 'p-3 flex flex-col flex-1 overflow-y-auto custom-scrollbar gap-2' : 'p-3 space-y-3 flex-1 overflow-y-auto custom-scrollbar';

            for (const { key, val, isTextArea } of validInputs) {
                if (node.class_type === 'easy stylesSelector' && key === 'select_styles') {
                    // ... (Styles logic kept same) ...
                    const container = document.createElement('div');
                    if (isGroupingMode && activeGroupId) {
                        const activeGroup = customGroups.find(g => g.id === activeGroupId);
                        const isChecked = activeGroup && activeGroup.inputs.some(i => i.nodeId === item.id && i.key === key);
                        const labelHtml = document.createElement('label');
                        labelHtml.className = "flex items-center gap-2 text-[9px] font-medium text-zinc-500 uppercase tracking-wider mb-1";
                        labelHtml.innerHTML = `<input type="checkbox" class="accent-orange-500 w-3 h-3" ${isChecked ? 'checked' : ''} onchange="toggleInputInGroup('${activeGroupId}', '${item.id}', '${key}')"><span>Include Styles in Group</span>`;
                        container.appendChild(labelHtml);
                    }
                    const wrap = createStyleSelector(node, key, val, fooocusStyles);
                    if (hasTextArea) wrap.className += " shrink-0";
                    container.appendChild(wrap);
                    body.appendChild(container);
                    continue;
                }

                const group = document.createElement('div');
                if (isTextArea && hasTextArea) group.className = 'flex flex-col flex-1 min-h-[60px]'; else group.className = 'space-y-1 shrink-0';

                let labelHtml = `<label class="flex items-center gap-2 text-[9px] font-medium text-zinc-500 uppercase tracking-wider">`;
                if (isGroupingMode && activeGroupId) {
                    const activeGroup = customGroups.find(g => g.id === activeGroupId);
                    const isChecked = activeGroup && activeGroup.inputs.some(i => i.nodeId === item.id && i.key === key);
                    labelHtml += `<input type="checkbox" class="accent-orange-500 w-3 h-3" ${isChecked ? 'checked' : ''} onchange="toggleInputInGroup('${activeGroupId}', '${item.id}', '${key}')">`;
                }
                labelHtml += `<span>${key.replace(/_/g,' ')}</span></label>`;
                group.innerHTML = labelHtml;

                const { dom } = createInputDOM(node, key, val, def);
                group.appendChild(dom);
                body.appendChild(group);
            }
            card.appendChild(body);
            
            if (isEditMode) {
                const handle = document.createElement('div');
                handle.className = "h-6 w-full bg-zinc-800/50 border-t border-zinc-700/50 cursor-ns-resize flex items-center justify-center hover:bg-zinc-700 transition-colors shrink-0 touch-none";
                handle.innerHTML = `<div class="w-8 h-1 bg-zinc-500/50 rounded-full"></div>`;
                makeCardResizable(card, handle);
                card.appendChild(handle);
            }
            els.controls.appendChild(card);
        }
    }
    els.controls.scrollTop = scrollTop;
}

// --- GROUPING FUNCTIONS ---

function startNewGroup() {
    isGroupingMode = true;
    const newGroup = {
        id: 'group_' + Date.now(),
        title: 'New Group',
        inputs: []
    };
    customGroups.unshift(newGroup);
    activeGroupId = newGroup.id;
    showGroupsOnly = false; 
    renderControls();
}

function editExistingGroup(id) {
    isGroupingMode = true;
    activeGroupId = id;
    showGroupsOnly = false; 
    renderControls();
}

function stopGrouping() {
    isGroupingMode = false;
    activeGroupId = null;
    saveGroups();
    renderControls();
}

window.moveGroupInput = function(groupId, index, direction) {
    const group = customGroups.find(g => g.id === groupId);
    if (!group) return;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= group.inputs.length) return;

    [group.inputs[index], group.inputs[newIndex]] = [group.inputs[newIndex], group.inputs[index]];
    saveGroups();
    renderControls();
}

window.toggleInputInGroup = function(groupId, nodeId, key) {
    const group = customGroups.find(g => g.id === groupId);
    if (!group) return;

    const existsIdx = group.inputs.findIndex(i => i.nodeId === nodeId && i.key === key);
    if (existsIdx > -1) {
        group.inputs.splice(existsIdx, 1);
    } else {
        group.inputs.push({ nodeId, key });
    }
    renderControls();
}

function deleteGroup(id) {
    if (!confirm("Delete this group?")) return;
    customGroups = customGroups.filter(g => g.id !== id);
    if(activeGroupId === id) {
        isGroupingMode = false;
        activeGroupId = null;
    }
    saveGroups();
    renderControls();
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    if (!isEditMode) {
        isGroupingMode = false;
        activeGroupId = null;
    }
    if(els.editBtn) els.editBtn.classList.toggle('text-blue-400', isEditMode);
    if(els.saveLayoutBtn) els.saveLayoutBtn.classList.toggle('hidden', !isEditMode);
    if(els.hiddenContainer) els.hiddenContainer.classList.toggle('hidden', !isEditMode);
    renderControls();
}

function makeCardResizable(card, handle) {
    let startY = 0;
    let startHeight = 0;
    const onDragStart = (y) => {
        startY = y;
        startHeight = card.offsetHeight;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';
    };
    const onDragMove = (y) => {
        const newHeight = Math.max(100, startHeight + (y - startY));
        card.style.height = `${newHeight}px`;
    };
    const onDragEnd = () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        removeListeners();
    };
    const onMouseMove = (e) => onDragMove(e.clientY);
    const onMouseUp = () => onDragEnd();
    handle.addEventListener('mousedown', (e) => {
        onDragStart(e.clientY);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
    const onTouchMove = (e) => onDragMove(e.touches[0].clientY);
    const onTouchEnd = () => {
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        onDragEnd();
    };
    handle.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) return;
        onDragStart(e.touches[0].clientY);
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd);
    }, { passive: true });
    function removeListeners() {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
    }
}

// Replace your existing run() function
async function run() {
    if(els.genBtn) els.genBtn.classList.add('hidden');
    if(els.stopBtn) els.stopBtn.classList.remove('hidden');
    if(els.loading) els.loading.classList.remove('hidden');
    if(els.progress) els.progress.innerText = '0%';

    // 1. UPDATE STATE & SAVE
    for (let id in loadedWorkflow) {
        const node = loadedWorkflow[id];
        if (!node || typeof node !== 'object') continue;
        if (node.class_type === 'KSampler' && node.inputs && node.inputs.seed !== undefined) {
            node.inputs.seed = Math.floor(Math.random() * 10000000000);
        }
    }
    await saveGroups(); 

    // 2. PREPARE PAYLOAD
    const apiPrompt = JSON.parse(JSON.stringify(loadedWorkflow));
    for (let id in apiPrompt) {
        const node = apiPrompt[id];
        if (id.startsWith('_')) { delete apiPrompt[id]; continue; }
        if (!node.class_type) { delete apiPrompt[id]; continue; }
        if (node.class_type === 'MiniGroup' || node.class_type === 'Note' || node.class_type === 'AppInfo') {
            delete apiPrompt[id];
            continue;
        }
    }

    // 3. META FORMAT (Fix for KeyError: 'nodes')
    const metaWorkflow = { "nodes": [], "links": [], "groups": [], "version": 0.4 };
    for (let [id, node] of Object.entries(loadedWorkflow)) {
        const nodeForMeta = { id: Number(id), type: node.class_type, ...node };
        metaWorkflow.nodes.push(nodeForMeta);
    }

    // 4. EXECUTE & CAPTURE ID
    try {
        const payload = { 
            client_id: clientId, 
            prompt: apiPrompt,
            extra_data: { extra_pnginfo: { workflow: metaWorkflow } }
        };

        console.log("[DEBUG] Sending Prompt:", payload);
        const res = await fetch('/prompt', { 
            method: 'POST', 
            body: JSON.stringify(payload) 
        });
        
        if (!res.ok) throw new Error(`Server Error ${res.status}`);
        
        const data = await res.json();
        console.log("[DEBUG] Run Started. Prompt ID:", data.prompt_id);
        
        // --- CAPTURE THE ID HERE ---
        currentPromptId = data.prompt_id;
        
        renderControls();
    } catch(e) { 
        alert("Run failed: " + e.message); 
        console.error(e);
        if(els.genBtn) els.genBtn.classList.remove('hidden'); 
        if(els.stopBtn) els.stopBtn.classList.add('hidden'); 
        if(els.loading) els.loading.classList.add('hidden');
    }
}

// --- UPDATED STYLE SELECTOR HELPERS ---
// NOW EXPORTED FOR AUTOMATION.JS
export function createStyleSelector(node, key, val, stylesList) {
    const wrapper = document.createElement('div');
    wrapper.className = "space-y-2";
    const selectedContainer = document.createElement('div');
    selectedContainer.className = "flex flex-wrap gap-1 min-h-[20px]";
    
    // Normalize Structure
    if (Array.isArray(node.inputs[key])) {
        node.inputs[key] = { "__value__": node.inputs[key] };
    } else if (!node.inputs[key] || typeof node.inputs[key] !== 'object') {
        node.inputs[key] = { "__value__": [] };
    } else if (!node.inputs[key].__value__) {
        node.inputs[key].__value__ = [];
    }

    const stylesArray = node.inputs[key].__value__;

    const updateSelected = () => {
        selectedContainer.innerHTML = '';
        if(stylesArray.length === 0) selectedContainer.innerHTML = '<span class="text-[9px] text-zinc-600 italic">No styles selected</span>';
        
        stylesArray.forEach(s => {
            const tag = document.createElement('span');
            tag.className = "bg-blue-900/40 border border-blue-800 text-blue-100 px-1.5 py-0.5 rounded text-[9px] flex items-center gap-1 cursor-pointer hover:bg-red-900/40 hover:border-red-800 transition-colors";
            tag.innerHTML = `${s} <span class="text-[8px] opacity-50">✕</span>`;
            tag.onclick = () => {
                const idx = stylesArray.indexOf(s);
                if(idx > -1) { 
                    stylesArray.splice(idx, 1); 
                    updateSelected(); 
                }
            };
            selectedContainer.appendChild(tag);
        });
    };
    
    const addBtn = document.createElement('button');
    addBtn.className = "w-full bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-zinc-300 text-[10px] py-1.5 rounded flex items-center justify-center gap-2 transition-colors mt-2";
    addBtn.innerText = "+ Add Style";
    addBtn.onclick = () => openStyleModal(node, key, updateSelected, stylesList);

    wrapper.appendChild(document.createTextNode("Selected Styles:"));
    wrapper.appendChild(selectedContainer);
    wrapper.appendChild(addBtn);
    updateSelected();
    return wrapper;
}

export function openStyleModal(node, key, callback, stylesList) {
    const modal = document.createElement('div');
    modal.className = "fixed inset-0 z-[100] bg-black/95 flex flex-col p-4 animate-in fade-in duration-200";
    const header = document.createElement('div');
    header.className = "flex justify-between items-center mb-4 border-b border-zinc-800 pb-2";
    header.innerHTML = '<h3 class="text-zinc-200 font-bold">Select Styles</h3>';
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<svg class="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
    closeBtn.onclick = () => { document.body.removeChild(modal); callback(); };
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const search = document.createElement('input');
    search.className = "w-full input-dark rounded p-2 mb-4 text-sm outline-none";
    search.placeholder = "Search styles...";
    modal.appendChild(search);

    const grid = document.createElement('div');
    grid.className = "flex-1 overflow-y-auto grid grid-cols-2 gap-2 content-start pb-10";
    
    const renderGrid = (filter = "") => {
        grid.innerHTML = "";
        const lowerFilter = filter.toLowerCase();
        const stylesArray = node.inputs[key].__value__;

        (stylesList || []).forEach(style => {
            if(!style.name.toLowerCase().includes(lowerFilter)) return;
            
            const isSel = stylesArray.includes(style.name);
            const card = document.createElement('div');
            card.className = `p-2 rounded border cursor-pointer flex items-center gap-2 transition-all ${isSel ? 'bg-blue-900/20 border-blue-600' : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800'}`;
            const img = document.createElement('img');
            img.src = style.thumbnail || '';
            img.className = "w-8 h-8 rounded bg-black object-cover shrink-0";
            const name = document.createElement('span');
            name.className = "text-[10px] text-zinc-300 leading-tight";
            name.innerText = style.name;
            card.append(img, name);
            card.onclick = () => {
                if(stylesArray.includes(style.name)) {
                    // Remove
                    const idx = stylesArray.indexOf(style.name);
                    if(idx > -1) stylesArray.splice(idx, 1);
                    card.className = card.className.replace('bg-blue-900/20 border-blue-600', 'bg-zinc-900 border-zinc-800');
                } else {
                    // Add
                    stylesArray.push(style.name);
                    card.className = card.className.replace('bg-zinc-900 border-zinc-800', 'bg-blue-900/20 border-blue-600');
                }
            };
            grid.appendChild(card);
        });
    };

    search.oninput = (e) => renderGrid(e.target.value);
    modal.appendChild(grid);
    document.body.appendChild(modal);
    renderGrid();
}

async function saveLayout() {
    loadedLayout = getSortedNodes(); 
    const cards = els.controls.querySelectorAll('.compact-card');
    cards.forEach(card => {
        const id = card.dataset.id;
        if (!id) return;
        const layoutItem = loadedLayout.find(item => String(item.id) === String(id));
        if (layoutItem) layoutItem.height = card.offsetHeight;
    });

    try {
        await Promise.all([
            fetch('/mini/save_layout', { method: 'POST', body: JSON.stringify(loadedLayout) }),
            saveGroups()
        ]);
        
        toggleEditMode();
        const btn = els.saveLayoutBtn;
        const originalText = btn.innerText;
        btn.innerText = "Saved!";
        setTimeout(() => btn.innerText = originalText, 2000);
        
    } catch(e) { 
        alert("Save Failed: " + e.message); 
    }
}
window.moveNode = moveNode;
window.setVisibility = setVisibility;
function moveNode(index, direction) {
    const list = getSortedNodes();
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= list.length) return;
    [list[index], list[newIndex]] = [list[newIndex], list[index]];
    loadedLayout = list;
    renderControls();
}
function setVisibility(id, visible) {
    let list = getSortedNodes(); 
    const idx = list.findIndex(x => x.id === id);
    if(idx > -1) {
        list[idx].visible = visible;
        loadedLayout = list;
        renderControls();
    }
}

async function interrupt() { await fetch('/interrupt', { method: 'POST' }); }

// --- SAFETY CHECK: ONLY RUN INIT ON MAIN PAGE ---
if (document.getElementById('controls-container')) {
    init();
}