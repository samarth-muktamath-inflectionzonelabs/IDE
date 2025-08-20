<script lang="ts">
  let { tree, onSelect, currentPath = '' } = $props<{
    tree: Record<string, any>;
    onSelect: (path: string) => void;
    currentPath?: string;
  }>();
  
  // STATE VARIABLES
  let expandedDirs = $state(new Set<string>());
  let showContextMenu = $state(false);
  let contextMenuPosition = $state({ x: 0, y: 0 });
  let contextMenuPath = $state('');
  let showCreateDialog = $state(false);
  let newItemName = $state('');
  let newItemType = $state<'file' | 'directory'>('file');
  let directoryContents = $state(new Map<string, Record<string, any>>());
  let loadingDirs = $state(new Set<string>());
  let showRenameDialog = $state(false);
  let oldItemName = $state('');
  let contextMenuType = $state<'file' | 'directory' | 'empty'>('empty');

  async function loadDirectoryContents(dirName: string, fullPath: string): Promise<void> {
    const userId: string | null = localStorage.getItem('userId');
    if (!userId) {
      console.error('❌ No userId in localStorage');
      return;
    }

    console.log('📁 Loading directory contents:', { dirName, fullPath });
    
    loadingDirs.add(dirName);
    loadingDirs = new Set(loadingDirs);
    
    try {
      const url: string = `http://localhost:9000/files/directory?userId=${encodeURIComponent(userId)}&path=${encodeURIComponent(fullPath)}`;
      console.log('📡 Request URL:', url);
      
      const response: Response = await fetch(url);
      
      if (!response.ok) {
        console.error('❌ Failed to load directory:', response.status, response.statusText);
        return;
      }
      
      const data: { items: string[] } = await response.json();
      const items: string[] = data.items || [];
      console.log('📦 Directory items received:', items);
      
      const dirTree: Record<string, any> = {};
      
      for (const item of items) {
        const [name, type] = item.split('|');
        if (name && type) {
          dirTree[name] = type === 'd' ? {} : null;
        }
      }
      
      console.log('🌳 Converted directory tree:', dirTree);
      
      directoryContents.set(dirName, dirTree);
      directoryContents = new Map(directoryContents);
      
    } catch (error) {
      console.error(`💥 Error loading directory ${fullPath}:`, error);
    } finally {
      loadingDirs.delete(dirName);
      loadingDirs = new Set(loadingDirs);
    }
  }

  // FORCE REFRESH ALL EXPANDED DIRECTORIES
  async function forceRefreshAllExpandedDirs(): Promise<void> {
    console.log('🔄 FORCE REFRESHING ALL EXPANDED DIRECTORIES');
    console.log('  - expandedDirs:', Array.from(expandedDirs));
    console.log('  - currentPath:', `"${currentPath}"`);
    
    // Clear all directory contents cache
    directoryContents.clear();
    directoryContents = new Map(directoryContents);
    
    // Reload all expanded directories
    for (const dirName of expandedDirs) {
      const fullPath = currentPath ? `${currentPath}/${dirName}` : dirName;
      console.log(`  🔄 Reloading expanded directory: ${dirName} (${fullPath})`);
      await loadDirectoryContents(dirName, fullPath);
    }
  }

  async function handleFileClick(name: string, isDir: boolean, fullPath: string): Promise<void> {
    console.log('👆 File click:', { name, isDir, fullPath });
    
    if (isDir) {
      if (expandedDirs.has(name)) {
        console.log('📂➡️📁 Collapsing directory:', name);
        expandedDirs.delete(name);
        expandedDirs = new Set(expandedDirs);
      } else {
        console.log('📁➡️📂 Expanding directory:', name);
        expandedDirs.add(name);
        expandedDirs = new Set(expandedDirs);
        
        await loadDirectoryContents(name, fullPath);
      }
    } else {
      console.log('📄 Opening file:', fullPath);
      onSelect(fullPath);
    }
  }

  function handleContextMenu(e: MouseEvent, name: string, fullPath: string, isDir: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('🖱️ RIGHT CLICK CONTEXT MENU:');
    console.log('  - name:', name);
    console.log('  - fullPath:', `"${fullPath}"`);
    console.log('  - isDir:', isDir);
    console.log('  - currentPath:', `"${currentPath}"`);
    
    contextMenuPosition = { x: e.clientX, y: e.clientY };
    contextMenuPath = fullPath;
    contextMenuType = isDir ? 'directory' : 'file';
    showContextMenu = true;
    
    console.log('🖱️ Context menu set:');
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    console.log('  - contextMenuType:', contextMenuType);
  }

  function handleEmptySpaceContextMenu(e: MouseEvent): void {
    if (e.target !== e.currentTarget) {
      console.log('🚫 Ignoring context menu - event from child element');
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    console.log('🖱️ EMPTY SPACE RIGHT CLICK:');
    console.log('  - currentPath:', `"${currentPath}"`);
    
    contextMenuPosition = { x: e.clientX, y: e.clientY };
    contextMenuPath = currentPath;
    contextMenuType = 'empty';
    showContextMenu = true;
    
    console.log('🖱️ Empty space context menu set:');
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    console.log('  - contextMenuType:', contextMenuType);
  }

  function createNewItem(type: 'file' | 'directory'): void {
    console.log('✨ CREATE NEW ITEM TRIGGERED:');
    console.log('  - type:', type);
    console.log('  - contextMenuType:', contextMenuType);
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    
    newItemType = type;
    newItemName = '';
    showCreateDialog = true;
    showContextMenu = false;
  }

  function renameItem(): void {
    console.log('✏️ RENAME ITEM TRIGGERED:');
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    
    const pathParts: string[] = contextMenuPath.split('/');
    oldItemName = pathParts[pathParts.length - 1];
    newItemName = oldItemName;
    
    console.log('  - oldItemName:', `"${oldItemName}"`);
    
    showRenameDialog = true;
    showContextMenu = false;
  }

  async function handleCreate(): Promise<void> {
    console.log('🚀 HANDLE CREATE FUNCTION CALLED:');
    console.log('  - newItemName:', `"${newItemName.trim()}"`);
    console.log('  - newItemType:', newItemType);
    console.log('  - contextMenuType:', contextMenuType);
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    console.log('  - currentPath:', `"${currentPath}"`);
    
    if (!newItemName.trim()) {
      alert('Please enter a name for the item.');
      return;
    }
    
    let parentPath: string = '';
    
    console.log('🎯 DETERMINING PARENT PATH:');
    if (contextMenuType === 'directory') {
      parentPath = contextMenuPath;
      console.log('  📂 Context: DIRECTORY - using contextMenuPath as parent');
      console.log('     parentPath =', `"${parentPath}"`);
    } else if (contextMenuType === 'file') {
      const pathParts: string[] = contextMenuPath.split('/');
      pathParts.pop();
      parentPath = pathParts.join('/');
      console.log('  📄 Context: FILE - using file\'s parent directory');
      console.log('     parentPath =', `"${parentPath}"`);
    } else {
      parentPath = currentPath;
      console.log('  🔳 Context: EMPTY - using currentPath');
      console.log('     parentPath =', `"${parentPath}"`);
    }
    
    console.log('✅ FINAL PARENT PATH:', `"${parentPath}"`);
    
    try {
      const userId: string | null = localStorage.getItem('userId');
      
      if (!userId) {
        console.error('❌ No userId in localStorage');
        alert('Session expired. Please refresh the page.');
        return;
      }
      
      console.log('👤 UserId:', userId);
      
      const requestPayload = {
        userId: userId,
        path: newItemName.trim(),
        type: newItemType,
        content: newItemType === 'file' ? '' : undefined,
        parentPath: parentPath
      };
      
      console.log('📤 CREATE REQUEST PAYLOAD:');
      console.log(JSON.stringify(requestPayload, null, 2));
      
      const response: Response = await fetch('http://localhost:9000/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });
      
      console.log('📥 CREATE Response status:', response.status);
      const result = await response.json();
      console.log('📥 CREATE Server response:', result);
      
      if (response.ok) {
        console.log('🎉 CREATE SUCCESS!');
        showCreateDialog = false;
        
        if (contextMenuType === 'directory') {
          console.log('🔄 Refreshing parent directory after create...');
          const dirName = contextMenuPath.split('/').pop() || contextMenuPath;
          await loadDirectoryContents(dirName, contextMenuPath);
        }
        
        console.log('🔄 Triggering main tree refresh after create...');
        await forceRefreshAllExpandedDirs();
        window.dispatchEvent(new CustomEvent('refreshFileTree'));
        
      } else {
        console.error('❌ CREATE FAILED:', result.error);
        alert(`Failed to create item: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('💥 CREATE Network error:', error);
      alert('Network error occurred.');
    }
  }

  async function handleRename(): Promise<void> {
    console.log('📝 === HANDLE RENAME STARTED ===');
    console.log('  - oldItemName:', `"${oldItemName}"`);
    console.log('  - newItemName:', `"${newItemName.trim()}"`);
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    
    if (!newItemName.trim() || newItemName.trim() === oldItemName) {
      console.log('❌ Rename cancelled - no change in name');
      return;
    }
    
    const pathParts: string[] = contextMenuPath.split('/');
    pathParts[pathParts.length - 1] = newItemName.trim();
    const newPath: string = pathParts.join('/');
    
    console.log('🛠️ RENAME PATH CALCULATION:');
    console.log('  - oldPath:', `"${contextMenuPath}"`);
    console.log('  - newPath:', `"${newPath}"`);
    console.log('  - pathParts:', pathParts);
    
    try {
      const userId: string | null = localStorage.getItem('userId');
      if (!userId) {
        console.error('❌ No userId for rename');
        return;
      }
      
      console.log('👤 Rename UserId:', userId);
      
      const renamePayload = {
        userId,
        oldPath: contextMenuPath,
        newPath: newPath
      };
      
      console.log('📤 RENAME REQUEST PAYLOAD:');
      console.log(JSON.stringify(renamePayload, null, 2));
      
      const response: Response = await fetch('http://localhost:9000/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renamePayload)
      });
      
      console.log('📥 RENAME Response status:', response.status);
      const result = await response.json();
      console.log('📥 RENAME Server response:', result);
      
      if (response.ok) {
        console.log('🎉 RENAME SUCCESS!');
        showRenameDialog = false;
        
        // CRITICAL FIX: Force refresh all expanded directories
        console.log('🔄 FORCE REFRESHING ALL EXPANDED DIRS AFTER RENAME...');
        await forceRefreshAllExpandedDirs();
        
        // Trigger main tree refresh
        console.log('🔄 Triggering main tree refresh after rename...');
        window.dispatchEvent(new CustomEvent('refreshFileTree'));
        
      } else {
        console.error('❌ RENAME FAILED:', result.error || 'Unknown error');
        alert('Failed to rename item: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('💥 RENAME Network error:', error);
      alert('Network error during rename.');
    }
    
    console.log('📝 === HANDLE RENAME COMPLETED ===');
  }

  async function handleDelete(): Promise<void> {
    const itemName: string = contextMenuPath.split('/').pop() || contextMenuPath;
    
    console.log('🗑️ === HANDLE DELETE STARTED ===');
    console.log('  - itemName:', `"${itemName}"`);
    console.log('  - contextMenuPath:', `"${contextMenuPath}"`);
    console.log('  - contextMenuType:', contextMenuType);
    
    if (!confirm(`Are you sure you want to delete "${itemName}"?`)) {
      console.log('❌ Delete cancelled by user');
      return;
    }
    
    try {
      const userId: string | null = localStorage.getItem('userId');
      if (!userId) {
        console.error('❌ No userId for delete');
        return;
      }
      
      console.log('👤 Delete UserId:', userId);
      
      const deleteUrl = `http://localhost:9000/files/delete?userId=${userId}&path=${encodeURIComponent(contextMenuPath)}`;
      console.log('📡 DELETE URL:', deleteUrl);
      
      const response: Response = await fetch(deleteUrl, {
        method: 'DELETE'
      });
      
      console.log('📥 DELETE Response status:', response.status);
      const result = await response.json();
      console.log('📥 DELETE Server response:', result);
      
      if (response.ok) {
        console.log('🎉 DELETE SUCCESS!');
        showContextMenu = false;
        
        // CRITICAL FIX: Force refresh all expanded directories
        console.log('🔄 FORCE REFRESHING ALL EXPANDED DIRS AFTER DELETE...');
        await forceRefreshAllExpandedDirs();
        
        // Trigger main tree refresh
        console.log('🔄 Triggering main tree refresh after delete...');
        window.dispatchEvent(new CustomEvent('refreshFileTree'));
        
      } else {
        console.error('❌ DELETE FAILED:', result.error || 'Unknown error');
        alert('Failed to delete item: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('💥 DELETE Network error:', error);
      alert('Network error during delete.');
    }
    
    console.log('🗑️ === HANDLE DELETE COMPLETED ===');
  }

  $effect(() => {
    const handleClick = (): void => {
      if (showContextMenu) {
        showContextMenu = false;
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  });
</script>

<div class="min-h-full w-full" on:contextmenu={handleEmptySpaceContextMenu}>
  {#each Object.entries(tree) as [name, value]}
    {#if value !== null && typeof value === 'object'}
      <!-- Directory -->
      <div class="my-1">
        <div 
          class="cursor-pointer px-1 py-1.5 select-none rounded flex items-center gap-1.5 transition-colors hover:bg-gray-100 {expandedDirs.has(name) ? 'bg-blue-50' : ''}"
          on:click={() => handleFileClick(name, true, currentPath ? `${currentPath}/${name}` : name)}
          on:contextmenu={(e) => handleContextMenu(e, name, currentPath ? `${currentPath}/${name}` : name, true)}
        >
          <span class="text-base">
            {#if loadingDirs.has(name)}
              ⏳
            {:else}
              {expandedDirs.has(name) ? '📂' : '📁'}
            {/if}
          </span>
          <span class="text-sm font-medium text-gray-800">{name}</span>
          {#if !expandedDirs.has(name) && !loadingDirs.has(name)}
            <span class="text-gray-500 text-xs ml-auto">(click to expand)</span>
          {/if}
        </div>
        
        {#if expandedDirs.has(name)}
          <div class="ml-6 border-l-2 border-gray-200 pl-3 mt-1">
            {#if loadingDirs.has(name)}
              <div class="text-gray-500 italic py-2 text-sm">Loading...</div>
            {:else if directoryContents.has(name)}
              {@const dirContent = directoryContents.get(name) || {}}
              {#if Object.keys(dirContent).length > 0}
                <svelte:self
                  tree={dirContent}
                  {onSelect}
                  currentPath={currentPath ? `${currentPath}/${name}` : name}
                />
              {:else}
                <div class="text-gray-500 italic py-2 text-sm">(empty directory)</div>
              {/if}
            {:else}
              <div class="text-red-600 italic py-2 text-sm">Failed to load contents</div>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <!-- File -->
      <div 
        class="cursor-pointer px-1 py-1.5 select-none rounded flex items-center gap-1.5 transition-colors hover:bg-gray-100 my-1"
        on:click={() => handleFileClick(name, false, currentPath ? `${currentPath}/${name}` : name)}
        on:contextmenu={(e) => handleContextMenu(e, name, currentPath ? `${currentPath}/${name}` : name, false)}
      >
        <span class="text-base">📄</span>
        <span class="text-sm text-gray-600">{name}</span>
      </div>
    {/if}
  {/each}

  <!-- Context Menu -->
  {#if showContextMenu}
    <div 
      class="fixed bg-white border border-gray-300 shadow-lg z-50 min-w-40 rounded-lg overflow-hidden"
      style="position: fixed; top: {contextMenuPosition.y}px; left: {contextMenuPosition.x}px;"
    >
      <div class="px-4 py-3 cursor-pointer border-b border-gray-100 flex items-center gap-2.5 text-sm transition-colors hover:bg-gray-50" on:click={() => createNewItem('file')}>
        <span class="text-base">📄</span>
        <span>New File</span>
      </div>
      <div class="px-4 py-3 cursor-pointer border-b border-gray-100 flex items-center gap-2.5 text-sm transition-colors hover:bg-gray-50" on:click={() => createNewItem('directory')}>
        <span class="text-base">📁</span>
        <span>New Folder</span>
      </div>
      
      {#if contextMenuType === 'file' || contextMenuType === 'directory'}
        <div class="px-4 py-3 cursor-pointer border-b border-gray-100 flex items-center gap-2.5 text-sm transition-colors hover:bg-gray-50" on:click={renameItem}>
          <span class="text-base">✏️</span>
          <span>Rename</span>
        </div>
        <div class="px-4 py-3 cursor-pointer text-red-600 flex items-center gap-2.5 text-sm transition-colors hover:bg-red-50" on:click={handleDelete}>
          <span class="text-base">🗑️</span>
          <span>Delete</span>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Create Dialog -->
  {#if showCreateDialog}
    <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div class="bg-white rounded-xl p-8 shadow-xl min-w-96">
        <h3 class="text-lg font-semibold text-gray-800 mb-5">
          Create New {newItemType === 'file' ? 'File' : 'Folder'}
          {#if contextMenuType === 'directory'}
            <br><small class="text-sm text-gray-600 font-normal">📂 Inside: {contextMenuPath || 'root'}</small>
          {:else if contextMenuType === 'file'}
            <br><small class="text-sm text-gray-600 font-normal">📁 In same directory as: {contextMenuPath}</small>
          {:else}
            <br><small class="text-sm text-gray-600 font-normal">📁 In: {currentPath || 'root'}</small>
          {/if}
        </h3>
        <input 
          bind:value={newItemName} 
          placeholder="Enter name..." 
          class="w-full mb-5 p-3 border-2 border-gray-200 rounded-md text-base outline-none transition-colors focus:border-blue-400"
          on:keydown={(e) => e.key === 'Enter' && handleCreate()}
          autofocus
        />
        <div class="flex gap-3 justify-end">
          <button 
            class="px-6 py-3 bg-gray-100 text-gray-600 rounded-md text-sm font-medium transition-colors hover:bg-gray-200"
            on:click={() => showCreateDialog = false}
          >
            Cancel
          </button>
          <button 
            class="px-6 py-3 bg-blue-500 text-white rounded-md text-sm font-medium transition-colors hover:bg-blue-600"
            on:click={handleCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Rename Dialog -->
  {#if showRenameDialog}
    <div class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
      <div class="bg-white rounded-xl p-8 shadow-xl min-w-96">
        <h3 class="text-lg font-semibold text-gray-800 mb-5">
          Rename {contextMenuType === 'file' ? 'File' : 'Folder'}
          <br><small class="text-sm text-gray-600 font-normal">Current: {oldItemName}</small>
        </h3>
        <input 
          bind:value={newItemName} 
          placeholder="Enter new name..." 
          class="w-full mb-5 p-3 border-2 border-gray-200 rounded-md text-base outline-none transition-colors focus:border-green-400"
          on:keydown={(e) => e.key === 'Enter' && handleRename()}
          autofocus
        />
        <div class="flex gap-3 justify-end">
          <button 
            class="px-6 py-3 bg-gray-100 text-gray-600 rounded-md text-sm font-medium transition-colors hover:bg-gray-200"
            on:click={() => showRenameDialog = false}
          >
            Cancel
          </button>
          <button 
            class="px-6 py-3 bg-green-500 text-white rounded-md text-sm font-medium transition-colors hover:bg-green-600"
            on:click={handleRename}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>
