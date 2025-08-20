<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import socket from '$lib/socket';
  import '@xterm/xterm/css/xterm.css';

  let terminalRef: HTMLDivElement | null = null;
  let isRendered = false;
  let term: any = null;

  onMount(() => {
    if (!browser || isRendered) return;
    isRendered = true;

    Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit')
    ]).then(([{ Terminal: XTerminal }, { FitAddon }]) => {
      term = new XTerminal({
        rows: 15,
        cols: 100,
        cursorBlink: true,
        fontSize: 14,
        lineHeight: 1.2,
        scrollback: 1000,
        convertEol: true,
        theme: {
          background: '#000000',
          foreground: '#00ff00'
        }
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      if (terminalRef) {
        term.open(terminalRef);
        
        setTimeout(() => {
          fitAddon.fit();
          term.write('Waiting for container...\r\n');
        }, 100);
      }

      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey) {
          if (event.code === 'KeyC' && event.type === 'keydown' && term.hasSelection()) {
            document.execCommand('copy');
            return false;
          }
          
          if (event.code === 'KeyV' && event.type === 'keydown') {
            navigator.clipboard.readText().then(text => {
              socket.emit("terminal:paste", text);
            });
            return false;
          }
        }
        
        return true;
      });

      term.onData((data: string) => {
        socket.emit('terminal:data', data);
      });

      function onTerminalData(data: string) {
        const clearSequences = [
          '\\u001b[2J',
          '\\u001b[H\\u001b[2J',
          '\\u001b[3J',
          '\\x1Bc'
        ];
        
        const hasClearSequence = clearSequences.some(seq => data.includes(seq));
        
        if (hasClearSequence) {
          term.clear();
          
          let cleanData = data;
          clearSequences.forEach(seq => {
            cleanData = cleanData.replace(new RegExp(seq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
          });
          
          if (cleanData) {
            term.write(cleanData);
          }
        } else {
          term.write(data);
        }
      }

      socket.on('terminal:ready', () => {
        if (term) {
          term.clear();
          term.write('Container ready! Setting up workspace...\r\n');
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      
      if (terminalRef) {
        resizeObserver.observe(terminalRef);
      }

      socket.on("terminal:data", onTerminalData);

      const cleanup = () => {
        resizeObserver.disconnect();
        socket.off("terminal:data", onTerminalData);
        socket.off("terminal:ready");
        term?.dispose();
      };

      window.addEventListener('beforeunload', cleanup);
    });
  });

  function clearTerminal() {
    if (term) {
      term.clear();
      socket.emit("terminal:data", "\x03");
      socket.emit("terminal:data", "cd /workspace\n");
      socket.emit("terminal:data", "export PS1='\\w$ '\n");
      socket.emit("terminal:data", "clear\n");
    }
  }
</script>

<div class="h-full w-full relative">
  <button 
    on:click={clearTerminal}
    class="absolute top-2 right-2 z-10 bg-red-600 hover:bg-red-700 text-white text-xs px-2 py-1 rounded font-medium cursor-pointer"
    title="Clear Terminal"
  >
    🗑️ Clear
  </button>
  
  <div bind:this={terminalRef} class="h-full w-full p-2" />
</div>
