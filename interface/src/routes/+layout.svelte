<script lang="ts">
    import type { Snippet } from 'svelte';
    import { onMount } from 'svelte';
    import socket from '$lib/socket';
    import Terminal from '$lib/components/Terminal.svelte';
    import FileTree from '$lib/components/FileTreeNode.svelte';
    import MonacoEditor from '$lib/components/MonacoEditor.svelte';
    import "../app.css";

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();

    let tree = $state<Record<string, any>>({});
    let loading = $state(true);
    let selectedFile = $state('');
    let selectedFileContent = $state('');
    let userId = $state('');

    async function loadFileTree() {
        try {
            console.log('🌳 === LOADING FILE TREE ===');
            console.log('Current userId for request:', userId);
            
            const url = userId ? `http://localhost:9000/files?userId=${userId}` : 'http://localhost:9000/files';
            console.log('Request URL:', url);
            
            const response = await fetch(url);
            const data = await response.json();
            tree = data.tree || {};
            loading = false;
            
            console.log('File tree loaded:', Object.keys(tree));
            console.log('Tree structure:', tree);
        } catch (error) {
            console.error('💥 Error loading file tree:', error);
            loading = false;
        }
    }

    async function loadFileContent(path: string) {
        if (!path) return;
        
        try {
            console.log('📄 Loading file content for path:', `"${path}"`);
            
            let cleanPath = String(path || '');
            
            cleanPath = cleanPath.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
            cleanPath = cleanPath.replace(/^['"\\/\\s]+|['"\\/\\s]+$/g, '');
            cleanPath = cleanPath.replace(/^workspace\//, '');
            cleanPath = cleanPath.replace(/\.\//g, '');
            
            console.log('Cleaned path:', `"${cleanPath}"`);
            
            if (!cleanPath || cleanPath.length === 0) {
                throw new Error('Invalid file path');
            }
            
            const params = new URLSearchParams({
                path: cleanPath,
                userId: userId
            });
            
            const response = await fetch(`http://localhost:9000/files/content?${params.toString()}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            let content = data.content || '';
            
            if (cleanPath.endsWith('.json') && content.trim()) {
                try {
                    const parsed = JSON.parse(content);
                    content = JSON.stringify(parsed, null, 2);
                } catch (jsonError) {
                    console.log('JSON parsing failed, using raw content:', jsonError);
                }
            }
            
            selectedFileContent = content;
            console.log('✅ File content loaded, length:', selectedFileContent.length);
            
        } catch (error) {
            console.error('💥 Failed to load file content:', error);
            selectedFileContent = '';
        }
    }

    function handleFileSelect(path: string): void {
        console.log('📂 Selected file path:', `"${path}"`);
        
        let cleanPath = String(path || '');
        cleanPath = cleanPath.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
        cleanPath = cleanPath.replace(/^['"\\s]+|['"\\s]+$/g, '');
        
        console.log('Cleaned file path:', `"${cleanPath}"`);
        
        if (!cleanPath || cleanPath.length === 0) {
            console.error('❌ Invalid file path after cleaning:', path);
            return;
        }
        
        selectedFileContent = '';
        selectedFile = cleanPath;
        
        loadFileContent(cleanPath);
    }

    function handleContentSave(path: string, content: string) {
        let cleanPath = String(path || '');
        cleanPath = cleanPath.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
        cleanPath = cleanPath.replace(/^['"\\/\\s]+|['"\\/\\s]+$/g, '');
        cleanPath = cleanPath.replace(/^workspace\//, '');
        
        console.log('💾 Saving content for cleaned path:', `"${cleanPath}"`);
        
        if (!cleanPath || cleanPath.length === 0) {
            console.error('❌ Invalid file path for save:', path);
            return;
        }
        
        socket.emit("file:change", {
            path: cleanPath,
            content: content,
        });
    }

    onMount(() => {
        console.log('🚀 === COMPONENT MOUNT ===');
        console.log('Socket connected status:', socket.connected);

        socket.on('connect', () => {
            userId = socket.id ?? '';
            console.log('🔌 === SOCKET CONNECTED ===');
            console.log(`Socket ID: ${socket.id}`);
            console.log(`Assigned userId: ${userId}`);
            
            // Store userId in localStorage
            localStorage.setItem('userId', userId);
            console.log('💾 UserId stored in localStorage:', localStorage.getItem('userId'));
            
            loadFileTree();
        });

        socket.on('disconnect', () => {
            console.log('🔌❌ === SOCKET DISCONNECTED ===');
            console.log('Previous userId:', userId);
        });

        socket.on('file:refresh', (path) => {
            console.log('🔄 === FILE REFRESH EVENT ===');
            console.log('Path changed:', path);
            console.log('Current userId:', userId);
            loadFileTree();
        });

        socket.on('terminal:data', (data) => {
            if (typeof data === 'string' && data.trim().endsWith('$')) {
                setTimeout(() => {
                    console.log('⚡ Terminal command completed, refreshing file tree');
                    loadFileTree();
                }, 300);
            }
        });

        // Listen for custom refresh events from FileTree component
        const handleRefreshEvent = () => {
            console.log('🔄 Custom refresh event received from FileTree');
            loadFileTree();
        };

        window.addEventListener('refreshFileTree', handleRefreshEvent);

        return () => {
            socket.off('file:refresh');
            socket.off('connect');
            socket.off('disconnect');
            socket.off('terminal:data');
            window.removeEventListener('refreshFileTree', handleRefreshEvent);
        };
    });
</script>

<svelte:head>
    <title>Code Editor</title>
</svelte:head>

<div class="h-screen flex flex-col">
    <div class="flex-1 flex overflow-hidden">
        <div class="w-64 bg-gray-100 border-r border-gray-300 overflow-y-auto">
            <div class="p-4">
                <h3 class="font-semibold text-gray-800 mb-3">Files</h3>
                <div class="text-xs text-gray-500 mb-2">UserId: {userId.slice(0, 8)}...</div>
                {#if loading}
                    <p class="text-gray-600 text-sm">Loading files...</p>
                {:else}
                    <FileTree tree={tree} onSelect={handleFileSelect} />
                {/if}
            </div>
        </div>

        <div class="flex-1 bg-white overflow-hidden pt-2">
            <MonacoEditor
                {selectedFile}
                {selectedFileContent}
                onContentSave={handleContentSave}
            />
        </div>
    </div>

    <div class="h-64 overflow-hidden">
        <Terminal />
    </div>
</div>
