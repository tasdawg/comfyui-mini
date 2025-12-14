const els = {
    grid: document.getElementById('workflow-grid'),
    uploadBtn: document.getElementById('upload-btn'),
    fileInput: document.getElementById('file-upload'),
    loading: document.getElementById('loading'),
    empty: document.getElementById('empty-msg'),
    status: document.getElementById('status-msg')
};

async function init() {
    els.uploadBtn.onclick = () => els.fileInput.click();
    els.fileInput.onchange = handleUpload;
    await loadWorkflows();
}

async function loadWorkflows() {
    els.loading.classList.remove('hidden');
    els.grid.innerHTML = '';
    els.empty.classList.add('hidden');

    try {
        const res = await fetch('/mini/list_workflows');
        const data = await res.json();
        
        if (!data.workflows || data.workflows.length === 0) {
            els.empty.classList.remove('hidden');
            els.loading.classList.add('hidden');
            return;
        }
        renderGrid(data.workflows);
    } catch (e) {
        console.error(e);
        els.status.innerText = "Error loading library";
    } finally {
        els.loading.classList.add('hidden');
    }
}

function renderGrid(files) {
    files.forEach(filename => {
        const card = document.createElement('div');
        card.className = "compact-card p-3 cursor-pointer group relative flex flex-col aspect-[4/3] justify-between hover:border-blue-500/50";
        
        // --- EDIT BUTTON (Top Left) ---
        const editBtn = document.createElement('button');
        editBtn.className = "card-action-btn absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 z-10";
        editBtn.title = "Open in Editor";
        editBtn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>`;
        
        // Handle Edit Click
        editBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent card click
            selectWorkflow(filename, '/mini/editor');
        };
        card.appendChild(editBtn);

        // --- ICON ---
        const iconDiv = document.createElement('div');
        iconDiv.className = "flex-1 flex items-center justify-center text-zinc-700 group-hover:text-zinc-500 transition-colors";
        iconDiv.innerHTML = `<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>`;
        
        // --- LABEL ---
        const label = document.createElement('div');
        label.className = "text-center w-full";
        const cleanName = filename.replace('.json', '');
        label.innerHTML = `<div class="text-[10px] font-bold text-zinc-400 truncate group-hover:text-blue-400 transition-colors">${cleanName}</div>`;

        card.append(iconDiv, label);
        
        // Handle Card Click (Run)
        card.onclick = () => selectWorkflow(filename, '/mini/run');
        
        els.grid.appendChild(card);
    });
}

// REPLACE your selectWorkflow function in home.js with this:

async function selectWorkflow(filename, redirectUrl) {
    // Simply redirect to the runner with the filename as a query parameter
    // Example: /mini/run?file=MyWorkflow.json
    const targetUrl = `${redirectUrl}?file=${encodeURIComponent(filename)}`;
    window.location.href = targetUrl;
}

async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    els.status.innerText = "Uploading...";
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/mini/upload_workflow', { method: 'POST', body: formData });
        if (res.ok) { 
            els.status.innerText = "Select a Workflow"; 
            await loadWorkflows(); 
        }
        else alert("Upload failed");
    } catch (e) { alert("Error uploading file"); } 
    finally { els.fileInput.value = ''; }
}

init();