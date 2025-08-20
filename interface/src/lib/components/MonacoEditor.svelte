<!-- MonacoEditor.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { browser } from '$app/environment';

  export let selectedFile: string = '';
  export let selectedFileContent: string = '';
  export let getFileMode: ((args: { selectedFile: string }) => string) | undefined = undefined;
  export let onContentSave: ((path: string, content: string) => void) | undefined = undefined;

  let code: string = '';
  let lastContent: string = '';
  let monaco: any;
  let editor: any;
  let editorContainer: HTMLDivElement;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver;
  const dispatch = createEventDispatcher();

  $: isSaved = code === selectedFileContent && code !== "";

  // MANUAL SAVE FUNCTION - FIXED
  function manualSave() {
    if (!browser) return;
    
    console.log(`💾 [DEBUG] Manual save triggered for: ${selectedFile}`);
    
    if (!selectedFile || code === undefined || code === null) {
      console.log('❌ [DEBUG] Cannot save - no file selected or no code');
      return;
    }
    
    // Clear auto-save timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
      console.log('🔄 [DEBUG] Cleared auto-save timeout');
    }
    
    // Clean the content before sending
    let cleanCode = String(code || '');
    const originalLength = cleanCode.length;
    cleanCode = cleanCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    cleanCode = cleanCode.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    
    console.log(`🧹 [DEBUG] Manual save - Original: ${originalLength}, Cleaned: ${cleanCode.length}`);
    
    // Update the saved state immediately
    selectedFileContent = cleanCode;
    
    if (onContentSave) {
      onContentSave(selectedFile, cleanCode);
      console.log(`✅ [DEBUG] Manual save - onContentSave called`);
    }
    
    dispatch('save', { path: selectedFile, content: cleanCode });
    console.log(`📡 [DEBUG] Manual save - Event dispatched`);
  }

  // KEYBOARD SHORTCUTS - FIXED
  function handleKeyDown(event: KeyboardEvent) {
    if (!browser) return;
    
    // Ctrl+S or Cmd+S for save
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      event.stopPropagation();
      console.log('🎯 [DEBUG] Ctrl+S detected, triggering save');
      manualSave();
      return false;
    }
  }

  async function loadMonacoFromCDN() {
    if (!browser) return null;
    
    return new Promise((resolve, reject) => {
      if ((window as any).monaco) {
        resolve((window as any).monaco);
        return;
      }

      const existingRequire = (window as any).require;
      const existingDefine = (window as any).define;
      
      delete (window as any).require;
      delete (window as any).define;

      const loaderScript = document.createElement('script');
      loaderScript.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs/loader.js';
      
      loaderScript.onload = () => {
        const require = (window as any).require;
        
        require.config({ 
          paths: { 
            vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs' 
          },
          'vs/nls': {
            availableLanguages: {
              '*': undefined
            }
          }
        });
        
        require(['vs/editor/editor.main'], () => {
          if (existingRequire) (window as any).require = existingRequire;
          if (existingDefine) (window as any).define = existingDefine;
          resolve((window as any).monaco);
        }, (error: any) => {
          console.error('Failed to load Monaco modules:', error);
          if (existingRequire) (window as any).require = existingRequire;
          if (existingDefine) (window as any).define = existingDefine;
          reject(error);
        });
      };
      
      loaderScript.onerror = (error) => {
        if (existingRequire) (window as any).require = existingRequire;
        if (existingDefine) (window as any).define = existingDefine;
        reject(error);
      };
      
      document.head.appendChild(loaderScript);
    });
  }

  onMount(async () => {
    if (!browser) return;
    
    console.log('🚀 [DEBUG] MonacoEditor mounting');
    
    // Add keyboard event listener - GLOBAL
    document.addEventListener('keydown', handleKeyDown, true);
    
    try {
      monaco = await loadMonacoFromCDN();
      
      if (!monaco) {
        console.error('Monaco failed to load');
        return;
      }
      
      console.log('✅ [DEBUG] Monaco loaded successfully');
      
      editor = monaco.editor.create(editorContainer, {
        value: '',
        language: getEditorLanguage(selectedFile, getFileMode),
        theme: 'vs-dark',
        automaticLayout: false,
        wordWrap: 'on',
        wordWrapColumn: 120,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
          useShadows: false,
          verticalHasArrows: false,
          horizontalHasArrows: false,
          verticalScrollbarSize: 14,
          horizontalScrollbarSize: 14
        },
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        formatOnPaste: true,
        formatOnType: true,
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: false
      });

      console.log('✅ [DEBUG] Monaco editor created');

      // ADD SAVE COMMAND TO MONACO - MULTIPLE KEYBINDINGS
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        console.log('🎯 [DEBUG] Monaco keybinding triggered');
        manualSave();
      });

      // BACKUP KEYBINDING
      editor.addAction({
        id: 'save-file',
        label: 'Save File',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          console.log('🎯 [DEBUG] Monaco action triggered');
          manualSave();
        }
      });

      editor.onDidChangeModelContent(() => {
        const newCode = editor.getValue();
        if (newCode !== code) {
          code = newCode;
          console.log('📝 [DEBUG] Editor content changed, length:', code.length);
        }
      });

      resizeObserver = new ResizeObserver(() => {
        if (editor) {
          try {
            editor.layout();
          } catch (e) {
            // Ignore layout errors
          }
        }
      });
      resizeObserver.observe(editorContainer);
      
      console.log('✅ [DEBUG] Monaco setup complete');
      
    } catch (error) {
      console.error('❌ [ERROR] Failed to initialize Monaco Editor:', error);
      createFallbackEditor();
    }
  });

  function createFallbackEditor() {
    if (!browser) return;
    
    console.log('🔄 [DEBUG] Creating fallback editor');
    
    editorContainer.innerHTML = `
      <div style="width: 100%; height: 100%; display: flex; flex-direction: column;">
        <div style="padding: 8px; background: #2d2d30; color: #cccccc; font-size: 12px; border-bottom: 1px solid #3c3c3c;">
          Monaco Editor failed to load - using fallback editor (Ctrl+S to save)
        </div>
        <textarea 
          id="fallback-editor"
          style="flex: 1; width: 100%; border: none; outline: none; resize: none; padding: 10px; background: #1e1e1e; color: #d4d4d4; font-family: 'Courier New', monospace; font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word;"
          placeholder="Loading..."
        ></textarea>
      </div>
    `;
    
    const textarea = editorContainer.querySelector('#fallback-editor') as HTMLTextAreaElement;
    if (textarea) {
      textarea.addEventListener('input', (e) => {
        code = (e.target as HTMLTextAreaElement).value;
      });
      
      textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          manualSave();
        }
      });
      
      editor = {
        setValue: (value: string) => { 
          textarea.value = value;
          code = value;
        },
        getValue: () => textarea.value || '',
        layout: () => {},
        dispose: () => {},
        addCommand: () => {},
        addAction: () => {}
      };
    }
  }

  onDestroy(() => {
    if (!browser) return;
    
    document.removeEventListener('keydown', handleKeyDown, true);
    if (resizeObserver) resizeObserver.disconnect();
    if (editor && editor.dispose) {
      try {
        editor.dispose();
      } catch (e) {
        // Ignore disposal errors
      }
    }
    if (saveTimeout) clearTimeout(saveTimeout);
  });

  // CONTENT UPDATE - FIXED
  $: if (browser && editor && selectedFile && selectedFileContent !== lastContent) {
    updateEditorContent();
  }

  function updateEditorContent() {
    if (!browser || !editor || !selectedFile) return;
    
    if (selectedFileContent === lastContent) return;
    
    console.log('🔄 [DEBUG] Updating editor content');
    
    lastContent = selectedFileContent;
    code = selectedFileContent;
    
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    
    try {
      let cleanContent = selectedFileContent || '';
      cleanContent = cleanContent.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
      cleanContent = cleanContent.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
      
      editor.setValue(cleanContent);
      
      if (monaco && monaco.editor && editor.getModel) {
        const language = getEditorLanguage(selectedFile, getFileMode);
        monaco.editor.setModelLanguage(editor.getModel(), language);
      }
    } catch (error) {
      console.error('❌ [ERROR] Error updating editor content:', error);
    }
  }

  // AUTO-SAVE - FIXED
  $: if (browser && editor && selectedFile && code !== selectedFileContent && code !== lastContent) {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
      console.log(`💾 [DEBUG] Auto-save triggered for: ${selectedFile}`);
      
      let cleanCode = String(code || '');
      cleanCode = cleanCode.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      cleanCode = cleanCode.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
      
      if (onContentSave) {
        onContentSave(selectedFile, cleanCode);
      }
      dispatch('save', { path: selectedFile, content: cleanCode });
    }, 2000);
  }

  function getEditorLanguage(path: string, customModeFn?: ((args: { selectedFile: string }) => string)): string {
    if (customModeFn) return customModeFn({ selectedFile: path });
    if (!path) return 'plaintext';
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': return 'javascript';
      case 'ts': return 'typescript';
      case 'css': return 'css';
      case 'html': return 'html';
      case 'json': return 'json';
      case 'md': return 'markdown';
      case 'svelte': return 'html';
      case 'py': return 'python';
      case 'java': return 'java';
      case 'cpp': case 'c': return 'cpp';
      case 'xml': return 'xml';
      case 'yaml': case 'yml': return 'yaml';
      default: return 'plaintext';
    }
  }
</script>

{#if selectedFile}
  <div style="margin-bottom:8px; padding: 8px; background: #f5f5f5; border-bottom: 1px solid #ddd;">
    <b>{selectedFile.replaceAll('/', ' > ')}</b>
    {#if isSaved}
      <span style="color: #4caf50; margin-left: 1em;">✅ Saved</span>
    {:else}
      <span style="color: #ff9800; margin-left: 1em;">⚠️ Unsaved (Ctrl+S to save)</span>
    {/if}
  </div>
{/if}
<div bind:this={editorContainer} style="width:100%;height:calc(100% - 45px);"></div>
