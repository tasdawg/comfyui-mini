import { createInputDOM, safeFetch, getObjectInfo, handleImageUpload, openModal, setupModalListeners, createStyleSelector } from './app.js';

window.openModal = openModal;

const els = {
    container: document.getElementById('steps-container'),
    selector: document.getElementById('workflow-selector'),
    savedSelector: document.getElementById('saved-automations'),
    addBtn: document.getElementById('add-step-btn'),
    saveBtn: document.getElementById('save-queue-btn'),
    runBtn: document.getElementById('run-all-btn'),
    stopBtn: document.getElementById('stop-btn'),
    empty: document.getElementById('empty-msg'),
    status: document.getElementById('status-text'),
    overlay: document.getElementById('status-overlay'),
    dot: document.getElementById('status-dot'),
    modal: document.getElementById('image-modal'),
    modalImg: document.getElementById('modal-image'),
    closeModal: document.getElementById('close-modal')
};

let automationQueue = []; 
let isRunning = false;
let socket = null;
let clientId = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
let currentStepIndex = -1;
let latestRenderId = 0; 
let fooocusStyles = []; 

async function init() {
    connectWS();
    setupModalListeners(); 
    fooocusStyles = await safeFetch('/mini/fooocus_styles.json', []);

    const res = await safeFetch('/mini/list_workflows', { workflows: [] });
    if (res.workflows) {
        res.workflows.forEach(wf => {
            const opt = document.createElement('option');
            opt.value = wf;
            opt.innerText = wf.replace('.json', '');
            els.selector.appendChild(opt);
        });
    }

    await refreshSavedAutomations();

    els.addBtn.onclick = addSelectedWorkflow;
    els.saveBtn.onclick = saveQueue;
    els.savedSelector.onchange = loadSelectedAutomation;
    els.runBtn.onclick = runAll;
    els.stopBtn.onclick = stopRun;
}

async function refreshSavedAutomations() {
    const res = await safeFetch('/mini/list_automations', { automations: [] });
    els.savedSelector.innerHTML = '<option value="" disabled selected>Load Saved...</option>';
    if (res.automations) {
        res.automations.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.innerText = f.replace('.json', '');
            els.savedSelector.appendChild(opt);
        });
    }
}

// --- QUEUE MANAGEMENT ---

async function addSelectedWorkflow() {
    const filename = els.selector.value;
    if (!filename) return;
    await addToQueue(filename);
}

async function addToQueue(filename) {
    const wfRes = await fetch(`/mini/get_workflow?filename=${encodeURIComponent(filename)}`);
    if (!wfRes.ok) { alert(`Could not load workflow: ${filename}`); return; }
    const workflowData = await wfRes.json();

    const groupRes = await fetch(`/mini/load_groups?filename=${encodeURIComponent(filename)}`);
    const groupData = await groupRes.json();

    if (!Array.isArray(groupData) || groupData.length === 0) {
        alert(`The workflow "${filename}" has no Groups defined.`);
        return;
    }

    const stepItem = {
        id: Date.now() + Math.random(),
        filename: filename,
        workflow: workflowData, 
        groups: groupData,
        status: 'pending',
        outputImage: null,
        outputImageMeta: null, 
        isFinished: false,
        connectedOutput: null, 
        connectedInput: null   
    };

    automationQueue.push(stepItem);
    renderQueue();
}

function removeStep(id) {
    automationQueue = automationQueue.filter(x => x.id !== id);
    renderQueue();
}

async function saveQueue() {
    if (automationQueue.length === 0) return alert("Queue is empty.");
    const name = prompt("Name this Automation Queue:");
    if (!name) return;

    const queueData = automationQueue.map(step => ({ 
        filename: step.filename,
        connectedOutput: step.connectedOutput,
        connectedInput: step.connectedInput
    }));

    try {
        const res = await fetch('/mini/save_automation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, queue: queueData })
        });
        if (res.ok) {
            alert("Saved!");
            await refreshSavedAutomations();
        } else {
            alert("Save failed.");
        }
    } catch (e) { console.error(e); }
}

async function loadSelectedAutomation() {
    const filename = els.savedSelector.value;
    if (!filename) return;

    if (automationQueue.length > 0 && !confirm("Replace current queue?")) {
        els.savedSelector.value = "";
        return;
    }

    try {
        const res = await fetch(`/mini/load_automation?filename=${encodeURIComponent(filename)}`);
        if (!res.ok) throw new Error("Failed to load");
        const queueData = await res.json(); 

        automationQueue = [];
        els.container.innerHTML = '';
        els.empty.classList.remove('hidden');

        for (const item of queueData) {
            await addToQueue(item.filename);
            const lastIdx = automationQueue.length - 1;
            if (lastIdx >= 0) {
                automationQueue[lastIdx].connectedOutput = item.connectedOutput;
                automationQueue[lastIdx].connectedInput = item.connectedInput;
            }
        }
        renderQueue(); 
        els.savedSelector.value = ""; 
    } catch (e) {
        alert("Error loading automation: " + e.message);
    }
}

// --- SAVING UPDATES TO LIBRARY ---
async function saveStepToLibrary(filename, workflow) {
    try {
        const payload = JSON.parse(JSON.stringify(workflow));
        payload._save_name = filename; // Tells backend where to save
        await fetch('/mini/save_library', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        console.log(`[Automation] Saved updated values to ${filename}`);
    } catch(e) { console.error("Auto-save failed:", e); }
}

// --- RENDERING ---

async function renderQueue() {
    const myRenderId = ++latestRenderId; 
    
    if (automationQueue.length === 0) {
        els.container.innerHTML = '';
        els.empty.classList.remove('hidden');
        return;
    }
    els.empty.classList.add('hidden');

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < automationQueue.length; i++) {
        if (myRenderId !== latestRenderId) return;

        const step = automationQueue[i];
        
        const card = document.createElement('div');
        card.id = `step-card-${i}`;
        const borderClass = step.status === 'running' ? 'border-blue-500 shadow-blue-900/20 shadow-lg' : 'border-[#27272a]';
        card.className = `compact-card flex flex-col overflow-hidden transition-all duration-300 ${borderClass}`;
        
        const header = document.createElement('div');
        header.className = "bg-[#18181b] px-3 py-2 border-b border-[#27272a] flex justify-between items-center";
        
        const titleDiv = document.createElement('div');
        titleDiv.className = "flex items-center gap-2";
        titleDiv.innerHTML = `
            <span class="step-number bg-zinc-800 text-zinc-400 text-[9px] px-1.5 rounded">${i + 1}</span>
            <span class="font-bold text-zinc-300 uppercase tracking-wider">${step.filename.replace('.json', '')}</span>
            ${step.status === 'running' ? '<span class="animate-pulse text-blue-400 text-[9px]">● RUNNING</span>' : ''}
            ${step.status === 'done' ? '<span class="text-green-400 text-[9px]">✔ DONE</span>' : ''}
        `;
        
        const controlsDiv = document.createElement('div');
        controlsDiv.className = "flex gap-2";
        
        const playBtn = document.createElement('button');
        playBtn.className = "text-zinc-500 hover:text-green-400 transition-colors";
        playBtn.innerHTML = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>`;
        playBtn.onclick = () => runSingleStep(i);
        
        const delBtn = document.createElement('button');
        delBtn.className = "text-zinc-500 hover:text-red-400 transition-colors";
        delBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>`;
        delBtn.onclick = () => removeStep(step.id);

        controlsDiv.append(playBtn, delBtn);
        header.append(titleDiv, controlsDiv);
        card.appendChild(header);

        const body = document.createElement('div');
        body.className = "p-3 space-y-4";

        const resultContainer = document.createElement('div');
        resultContainer.id = `result-container-${i}`;
        if (step.outputImage) {
            renderResultImage(resultContainer, step.outputImage, step.isFinished);
        }
        body.appendChild(resultContainer);

        let allInputs = [];
        let hasSaveImage = false;

        for (const nodeId in step.workflow) {
            const n = step.workflow[nodeId];
            if (n.class_type && (n.class_type.includes("SaveImage") || n.class_type === "Save Image")) {
                hasSaveImage = true;
                break;
            }
        }

        for (const group of step.groups) {
            if (myRenderId !== latestRenderId) return;

            const groupDiv = document.createElement('div');
            groupDiv.className = "space-y-2";
            
            const groupTitleBar = document.createElement('div');
            groupTitleBar.className = "flex items-center gap-2 border-b border-orange-500/20 pb-1 mb-2";
            const groupTitle = document.createElement('span');
            groupTitle.className = "text-[10px] font-bold text-orange-200/70 uppercase tracking-widest";
            groupTitle.innerText = group.title;
            groupTitleBar.appendChild(groupTitle);

            const imageInputRef = group.inputs.find(ref => {
                const n = step.workflow[ref.nodeId];
                return n && (n.class_type === "LoadImage" || n.class_type === "LoadImageMask");
            });

            if (imageInputRef) {
                const uploadBtn = document.createElement('button');
                uploadBtn.className = "text-zinc-400 hover:text-orange-400 transition-colors";
                uploadBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>`;
                const progressSpan = document.createElement('span');
                progressSpan.className = "text-[9px] font-bold text-zinc-500 hidden";
                uploadBtn.onclick = () => {
                    const inputEl = card.querySelector(`input[data-node="${imageInputRef.nodeId}"][data-key="${imageInputRef.key}"], select[data-node="${imageInputRef.nodeId}"][data-key="${imageInputRef.key}"]`);
                    if(inputEl) {
                        handleImageUpload(imageInputRef.nodeId, imageInputRef.key, progressSpan, inputEl, (filename) => {
                            step.workflow[imageInputRef.nodeId].inputs[imageInputRef.key] = filename;
                        });
                    }
                };
                groupTitleBar.appendChild(uploadBtn);
                groupTitleBar.appendChild(progressSpan);
            }
            groupDiv.appendChild(groupTitleBar);

            for (const inputRef of group.inputs) {
                const node = step.workflow[inputRef.nodeId];
                if (!node) continue;
                
                allInputs.push({ 
                    nodeId: inputRef.nodeId, 
                    key: inputRef.key, 
                    label: inputRef.key.replace(/_/g, ' ') 
                });

                if (inputRef.key === 'select_styles') {
                    const wrap = createStyleSelector(node, inputRef.key, null, fooocusStyles);
                    groupDiv.appendChild(wrap);
                    continue;
                }

                let def = await getObjectInfo(node.class_type);
                const inputWrapper = document.createElement('div');
                inputWrapper.className = "space-y-1";
                
                let labelHtml = `<span class="block text-[9px] font-medium text-zinc-500 uppercase">`;
                
                if (step.connectedInput && String(step.connectedInput.nodeId) === String(inputRef.nodeId) && step.connectedInput.key === inputRef.key) {
                    labelHtml += `<span class="text-orange-500 font-bold mr-1">→</span>`;
                }
                
                labelHtml += inputRef.key.replace(/_/g, ' ');

                if (step.connectedOutput && String(step.connectedOutput.nodeId) === String(inputRef.nodeId) && step.connectedOutput.key === inputRef.key) {
                    labelHtml += `<span class="text-orange-500 font-bold ml-1">←</span>`;
                }
                
                labelHtml += `</span>`;
                inputWrapper.innerHTML = labelHtml;

                const { dom } = createInputDOM(node, inputRef.key, node.inputs[inputRef.key], def);
                
                const tagEl = dom.tagName === 'DIV' ? dom.querySelector('input, textarea, select') : dom;
                if(tagEl) {
                    tagEl.dataset.node = inputRef.nodeId;
                    tagEl.dataset.key = inputRef.key;
                }
                inputWrapper.appendChild(dom);
                groupDiv.appendChild(inputWrapper);
            }
            body.appendChild(groupDiv);
        }
        
        const footer = document.createElement('div');
        footer.className = "mt-4 pt-2 border-t border-zinc-800 flex gap-2";
        
        const outSelect = document.createElement('select');
        outSelect.className = "flex-1 input-dark rounded p-1 text-[9px] text-zinc-400 uppercase";
        outSelect.innerHTML = `<option value="">Pass Output To Next...</option>`;
        
        if (hasSaveImage) {
            const isImgSel = step.connectedOutput && step.connectedOutput.special === 'IMAGE';
            outSelect.innerHTML += `<option value='{"special":"IMAGE"}' ${isImgSel ? 'selected' : ''}>★ GENERATED IMAGE</option>`;
        }

        allInputs.forEach(inp => {
            const val = JSON.stringify({ nodeId: inp.nodeId, key: inp.key });
            const isSel = step.connectedOutput && !step.connectedOutput.special && String(step.connectedOutput.nodeId) === String(inp.nodeId) && step.connectedOutput.key === inp.key;
            outSelect.innerHTML += `<option value='${val}' ${isSel ? 'selected' : ''}>${inp.label}</option>`;
        });
        outSelect.onchange = (e) => {
            step.connectedOutput = e.target.value ? JSON.parse(e.target.value) : null;
            renderQueue();
        };

        const inSelect = document.createElement('select');
        inSelect.className = "flex-1 input-dark rounded p-1 text-[9px] text-zinc-400 uppercase";
        inSelect.innerHTML = `<option value="">Receive Input From Prev...</option>`;
        allInputs.forEach(inp => {
            const val = JSON.stringify({ nodeId: inp.nodeId, key: inp.key });
            const isSel = step.connectedInput && String(step.connectedInput.nodeId) === String(inp.nodeId) && step.connectedInput.key === inp.key;
            inSelect.innerHTML += `<option value='${val}' ${isSel ? 'selected' : ''}>${inp.label}</option>`;
        });
        inSelect.onchange = (e) => {
            step.connectedInput = e.target.value ? JSON.parse(e.target.value) : null;
            renderQueue();
        };

        footer.appendChild(outSelect);
        footer.appendChild(inSelect);
        body.appendChild(footer);

        card.appendChild(body);
        fragment.appendChild(card);
    }

    if (myRenderId === latestRenderId) {
        els.container.innerHTML = '';
        els.container.appendChild(fragment);
    }
}

function renderResultImage(container, src, isFinished) {
    container.className = "relative w-full h-48 bg-zinc-900 rounded mb-4 group overflow-hidden border border-zinc-800";
    const downloadBtn = isFinished 
        ? `<a href="${src}" download="output_${Date.now()}.png" class="absolute top-2 right-2 bg-black/60 hover:bg-blue-600 text-white p-1.5 rounded backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider" title="Download Image" onclick="event.stopPropagation()">
             <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
             Download
           </a>`
        : `<div class="absolute top-2 right-2 bg-black/40 text-blue-200 px-2 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider backdrop-blur-sm animate-pulse">Generating...</div>`;

    container.innerHTML = `
        <img src="${src}" class="w-full h-full object-contain cursor-pointer" onclick="openModal('${src}')">
        ${downloadBtn}
    `;
}

// --- EXECUTION ---

async function runAll() {
    if (automationQueue.length === 0 || isRunning) return;
    
    // SAVE ALL CHANGES BEFORE RUNNING
    for (const step of automationQueue) {
        await saveStepToLibrary(step.filename, step.workflow);
    }

    isRunning = true;
    updateUIState();

    for (let i = 0; i < automationQueue.length; i++) {
        if (!isRunning) break;
        currentStepIndex = i;
        await executeStep(i);
    }

    isRunning = false;
    currentStepIndex = -1;
    updateUIState();
}

async function runSingleStep(index) {
    if (isRunning) return;
    
    // SAVE CHANGES BEFORE RUNNING
    const step = automationQueue[index];
    await saveStepToLibrary(step.filename, step.workflow);

    isRunning = true;
    currentStepIndex = index;
    updateUIState();
    await executeStep(index);
    isRunning = false;
    currentStepIndex = -1;
    updateUIState();
}

async function executeStep(index) {
    const step = automationQueue[index];
    
    // --- CONNECTION LOGIC ---
    if (index > 0 && step.connectedInput) {
        const prevStep = automationQueue[index - 1];
        
        if (prevStep.connectedOutput) {
            
            let shouldBridge = false;
            
            if (prevStep.connectedOutput.special === 'IMAGE') {
                shouldBridge = true;
            } else if (prevStep.connectedOutput.key === 'filename_prefix') {
                const prevNode = prevStep.workflow[prevStep.connectedOutput.nodeId];
                if (prevNode && (prevNode.class_type.includes("Save") || prevNode.class_type === 'Save Image')) {
                    shouldBridge = true;
                }
            }

            if (shouldBridge) {
                if (prevStep.outputImageMeta) {
                    console.log(`[Automation] Bridging Image from Step ${index-1} to Step ${index}...`);
                    try {
                        const bridgeRes = await fetch('/mini/bridge_image', { 
                            method: 'POST', 
                            body: JSON.stringify(prevStep.outputImageMeta) 
                        });
                        
                        if (bridgeRes.ok) {
                            const bridgeData = await bridgeRes.json();
                            const currNode = step.workflow[step.connectedInput.nodeId];
                            if (currNode) {
                                currNode.inputs[step.connectedInput.key] = bridgeData.filename;
                                console.log(`[Automation] Image bridged successfully: ${bridgeData.filename}`);
                            }
                        } else {
                            console.error("Bridge Image Failed");
                        }
                    } catch(e) { console.error("Bridge Error", e); }
                } else {
                    console.warn("Previous step selected for IMAGE bridge but no image meta found.");
                }
            }
            // STANDARD VALUE PASSING
            else {
                const prevNode = prevStep.workflow[prevStep.connectedOutput.nodeId];
                if (prevNode) {
                    const valToPass = prevNode.inputs[prevStep.connectedOutput.key];
                    if (valToPass !== undefined) {
                        const currNode = step.workflow[step.connectedInput.nodeId];
                        if (currNode) {
                            currNode.inputs[step.connectedInput.key] = valToPass;
                            console.log(`[Automation] Passed value '${valToPass}' from Step ${index-1} to Step ${index}`);
                        }
                    }
                }
            }
        }
    }

    step.status = 'running';
    step.outputImage = null; 
    step.outputImageMeta = null;
    step.isFinished = false;

    renderQueue(); 

    els.status.innerText = `Running Step ${index+1}: ${step.filename}...`;
    els.overlay.classList.remove('hidden');

    const apiPrompt = JSON.parse(JSON.stringify(step.workflow));
    for (let id in apiPrompt) {
        const node = apiPrompt[id];
        if (id.startsWith('_') || !node.class_type || node.class_type === 'MiniGroup') {
            delete apiPrompt[id];
        }
        if (node.class_type === 'KSampler' && node.inputs && node.inputs.seed) {
            node.inputs.seed = Math.floor(Math.random() * 10000000000);
        }
    }

    try {
        const payload = { client_id: clientId, prompt: apiPrompt };
        const res = await fetch('/prompt', { method: 'POST', body: JSON.stringify(payload) });
        if (!res.ok) throw new Error("API Error");
        
        const data = await res.json();
        const promptId = data.prompt_id;

        await new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (!isRunning) { clearInterval(checkInterval); reject("Stopped"); }
            }, 100);

            const handler = (e) => {
                try {
                    if (e.data instanceof ArrayBuffer) {
                        const blob = new Blob([e.data.slice(8)], { type: 'image/jpeg' });
                        const url = URL.createObjectURL(blob);
                        step.outputImage = url;
                        step.isFinished = false;
                        const cont = document.getElementById(`result-container-${index}`);
                        if(cont) renderResultImage(cont, url, false);
                        return;
                    }

                    const msg = JSON.parse(e.data);
                    if (msg.type === 'executed' && msg.data.output.images) {
                        const img = msg.data.output.images[0];
                        const url = `/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}&t=${Date.now()}`;
                        step.outputImage = url;
                        step.outputImageMeta = img; // Store meta for bridging
                        step.isFinished = true;
                        const cont = document.getElementById(`result-container-${index}`);
                        if(cont) renderResultImage(cont, url, true);
                    }

                    if (msg.type === 'status' && msg.data.status.exec_info.queue_remaining === 0) {
                        socket.removeEventListener('message', handlerWrapper);
                        clearInterval(checkInterval);
                        resolve();
                    }
                } catch(err) {}
            };
            const handlerWrapper = (e) => handler(e);
            socket.addEventListener('message', handlerWrapper);
        });

        step.status = 'done';
        await updateStepFromHistory(index, promptId);
        
        // SAVE FINAL STATE (Seeds, Bridged inputs)
        await saveStepToLibrary(step.filename, step.workflow);

    } catch (e) {
        console.error(e);
        step.status = 'error';
        els.status.innerText = "Error in Step " + (index+1);
    }
    
    renderQueue();
}

async function updateStepFromHistory(stepIndex, promptId) {
    try {
        const res = await fetch(`/history/${promptId}`);
        if (!res.ok) return;
        const history = await res.json();
        const runData = history[promptId];
        if (!runData || !runData.outputs) return;

        const card = document.getElementById(`step-card-${stepIndex}`);
        if(!card) return;
        const inputs = card.querySelectorAll('input, textarea, select');
        
        const updateInput = (nodeId, key, val) => {
            const target = Array.from(inputs).find(el => el.dataset.node == nodeId && el.dataset.key == key);
            if (target) {
                target.value = val;
                target.classList.add('bg-blue-900/50', 'text-white');
                setTimeout(() => target.classList.remove('bg-blue-900/50', 'text-white'), 1000);
                const step = automationQueue[stepIndex];
                if(step.workflow[nodeId] && step.workflow[nodeId].inputs) {
                    step.workflow[nodeId].inputs[key] = val;
                }
            }
        };

        for (const [nodeId, outputs] of Object.entries(runData.outputs)) {
            for (const [key, val] of Object.entries(outputs)) {
                if(key === 'images') continue;
                let valToSet = Array.isArray(val) ? val[0] : val;
                if (typeof valToSet === 'object') continue;
                updateInput(nodeId, key, valToSet);
                if (key === 'text') updateInput(nodeId, 'text_0', valToSet);
            }
        }
    } catch(e) { console.error("History update failed", e); }
}

function stopRun() {
    isRunning = false;
    fetch('/interrupt', { method: 'POST' });
    updateUIState();
}

function updateUIState() {
    if (isRunning) {
        els.runBtn.classList.add('hidden');
        els.stopBtn.classList.remove('hidden');
        els.addBtn.disabled = true;
        els.addBtn.classList.add('opacity-50');
    } else {
        els.runBtn.classList.remove('hidden');
        els.stopBtn.classList.add('hidden');
        els.addBtn.disabled = false;
        els.addBtn.classList.remove('opacity-50');
        els.overlay.classList.add('hidden');
    }
}

function connectWS() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${proto}//${window.location.host}/ws?clientId=${clientId}`);
    socket.binaryType = "arraybuffer"; 
    socket.onopen = () => { if(els.dot) els.dot.classList.replace('bg-red-500', 'bg-green-500'); };
    socket.onclose = () => { 
        if(els.dot) els.dot.classList.replace('bg-green-500', 'bg-red-500'); 
        setTimeout(connectWS, 2000); 
    };
}

init();
