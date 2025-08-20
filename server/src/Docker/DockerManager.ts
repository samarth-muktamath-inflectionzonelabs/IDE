import Docker from 'dockerode';
import tar from 'tar-stream';
import { Readable } from 'stream';
import { promises as fs } from 'fs';
import path from 'path';

export class DockerManager {
  private docker: Docker;
  private userContainers = new Map<string, Docker.Container>();
  private userShells = new Map<string, any>();

  constructor() {
    this.docker = new Docker();
  }

  public getUserShellStream(userId: string): any {
    return this.userShells.get(userId);
  }

  async buildUserImage(): Promise<void> {
    console.log('Building user environment image...');
    await new Promise<void>((resolve, reject) => {
      this.docker.buildImage(
        {
          context: '.',
          src: ['Dockerfile.user']
        },
        {
          t: 'user-env:latest',
          dockerfile: 'Dockerfile.user'
        },
        (err, stream) => {
          if (err) return reject(err);
          stream?.on('data', (data: Buffer) => process.stdout.write(data.toString()));
          stream?.on('end', () => resolve());
          stream?.on('error', reject);
        }
      );
    });
    console.log('User environment image built successfully');
  }

  async createUserContainer(userId: string): Promise<Docker.Container> {
    const hostPath: string = path.resolve(process.cwd(), 'user');
    
    try {
      await fs.stat(hostPath);
    } catch (error) {
      await fs.mkdir(hostPath, { recursive: true });
    }
    
    try {
      await fs.chmod(hostPath, 0o755);
      console.log(`Set permissions for: ${hostPath}`);
    } catch (error) {
      console.warn('Could not set permissions:', error);
    }
    
    const container: Docker.Container = await this.docker.createContainer({
      Image: 'user-env:latest',
      name: `user-${userId}`,
      Cmd: ['/bin/bash'],
      Tty: true,
      OpenStdin: true,
      WorkingDir: '/workspace',
      User: '0:0',
      Env: [
        'LANG=C.UTF-8',
        'LC_ALL=C.UTF-8',
        'TERM=xterm-256color'
      ],
      HostConfig: {
        Memory: 536870912,
        CpuShares: 512,
        AutoRemove: true,
        Binds: [`${hostPath}:/workspace:rw`]
      }
    });

    await container.start();
    this.userContainers.set(userId, container);

    try {
      const exec = await container.exec({
        Cmd: ['chmod', '-R', '755', '/workspace'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });
      await exec.start({ hijack: true, stdin: false, Tty: false });
      console.log('Fixed container permissions');
    } catch (error) {
      console.warn('Could not fix container permissions:', error);
    }

    await this.createPersistentShell(userId);
    return container;
  }

  async createPersistentShell(userId: string): Promise<void> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) return;

    try {
      const exec = await container.exec({
        Cmd: ['/bin/bash', '-i'],
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: true,
        Tty: true
      });

      const stream = await exec.start({
        Tty: true,
        hijack: true,
        stdin: true
      });

      this.userShells.set(userId, stream);

      setTimeout(() => {
        stream.write('\ncd /workspace\n');
        stream.write("export PS1='\\w$ '\n");
        stream.write('clear\n');
      }, 100);

    } catch (err) {
      console.error(`Failed to create shell for user ${userId}:`, err);
    }
  }

  getContainer(userId: string): Docker.Container | undefined {
    return this.userContainers.get(userId);
  }

  async writeFileToContainer(userId: string, filePath: string, content: string): Promise<void> {
    console.log(`🔧 [DEBUG] writeFileToContainer START - User: ${userId}, File: ${filePath}, Content length: ${content.length}`);
    console.log(`🔍 [DEBUG] Raw content first 100 chars:`, JSON.stringify(content.substring(0, 100)));
    
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) {
      console.error(`❌ [ERROR] writeFileToContainer - Container not found for user: ${userId}`);
      return;
    }

    // ULTRA-AGGRESSIVE CONTENT SANITIZATION
    let sanitizedContent = content;
    
    // Log original content bytes
    const originalBytes = Buffer.from(content, 'utf8');
    console.log(`🔍 [DEBUG] Original content bytes (first 20):`, Array.from(originalBytes.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    
    // Remove ALL control characters including SOH (0x01), STX (0x02), etc.
    // Keep only: \n (0x0A), \t (0x09), and printable characters (0x20-0x7E, 0x80-0xFF)
    sanitizedContent = sanitizedContent.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
    
    // Additional cleanup for Unicode control characters
    sanitizedContent = sanitizedContent.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    
    // Normalize line endings to Unix format
    sanitizedContent = sanitizedContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Force re-encode as clean UTF-8
    const cleanBuffer = Buffer.from(sanitizedContent, 'utf8');
    sanitizedContent = cleanBuffer.toString('utf8');
    
    console.log(`📝 [DEBUG] Original length: ${content.length}, Sanitized length: ${sanitizedContent.length}`);
    console.log(`🔍 [DEBUG] Sanitized content first 100 chars:`, JSON.stringify(sanitizedContent.substring(0, 100)));
    console.log(`🔍 [DEBUG] Sanitized content bytes (first 20):`, Array.from(cleanBuffer.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
    
    // SAFE TAR PACKING with explicit encoding
    const pack = tar.pack();
    
    const cleanFilePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    console.log(`📦 [DEBUG] writeFileToContainer - Clean file path: ${cleanFilePath}`);
    
    // Create the entry with explicit buffer and size
    const contentBuffer = Buffer.from(sanitizedContent, 'utf8');
    
    pack.entry({ 
      name: cleanFilePath,
      size: contentBuffer.length,
      mode: 0o644  // Explicit file permissions
    }, contentBuffer, (err) => {
      if (err) {
        console.error(`❌ [ERROR] writeFileToContainer - Pack entry error for '${cleanFilePath}':`, err);
        throw err;
      }
      console.log(`✅ [DEBUG] writeFileToContainer - Entry packed successfully for file '${cleanFilePath}'`);
    });
    
    pack.finalize();
    console.log(`📦 [DEBUG] writeFileToContainer - Pack finalized for file '${cleanFilePath}'`);

    try {
      console.log(`🚀 [DEBUG] writeFileToContainer - Putting archive for user '${userId}', file '${cleanFilePath}'`);
      await container.putArchive(pack, { path: '/workspace' });
      console.log(`✅ [DEBUG] writeFileToContainer - Archive put successfully`);
    } catch (archiveError) {
      console.error(`❌ [ERROR] writeFileToContainer - putArchive failed:`, archiveError);
      throw archiveError;
    }
    
    // ENHANCED VERIFICATION - Check if file was written correctly
    try {
      console.log(`🔄 [DEBUG] writeFileToContainer - Starting verification`);
      
      // First sync
      const syncExec = await container.exec({
        Cmd: ['sync'],
        AttachStdout: false,
        AttachStderr: false,
        Tty: false
      });
      await syncExec.start({ hijack: false });
      console.log(`✅ [DEBUG] writeFileToContainer - Sync completed`);
      
      // Wait for file system
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify file content
      const verifyExec = await container.exec({
        Cmd: ['head', '-c', '50', `/workspace/${cleanFilePath}`],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });
      
      const verifyStream = await verifyExec.start({ hijack: true, stdin: false, Tty: false });
      let verifyOutput = '';
      
      verifyStream.on('data', (chunk: Buffer) => {
        verifyOutput += chunk.toString();
      });
      
      await new Promise(resolve => verifyStream.on('end', resolve));
      
      console.log(`🔍 [DEBUG] writeFileToContainer - File verification output:`, JSON.stringify(verifyOutput.substring(0, 50)));
      
    } catch (err) {
      console.warn(`⚠️ [WARNING] writeFileToContainer - Verification failed:`, err);
    }
    
    console.log(`🎉 [DEBUG] writeFileToContainer COMPLETE - User: ${userId}, File: ${filePath}`);
  }

  async cleanupDuplicateFiles(userId: string): Promise<void> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) return;

    try {
      console.log(`🧹 [DEBUG] Starting cleanup of incomplete files for user: ${userId}`);
      
      // Only remove files that are clearly incomplete (single letter extensions without common ones)
      const exec = await container.exec({
        Cmd: ['find', '/workspace', '-name', '*.j', '-type', 'f', '!', '-name', '*.js', '!', '-name', '*.json', '-delete'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });
      await exec.start({ hijack: true, stdin: false, Tty: false });
      
      // Clean up other clearly incomplete extensions
      const exec2 = await container.exec({
        Cmd: ['find', '/workspace', '-name', '*.t', '-type', 'f', '!', '-name', '*.ts', '!', '-name', '*.txt', '-delete'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });
      await exec2.start({ hijack: true, stdin: false, Tty: false });
      
      console.log(`🧹 [DEBUG] Cleaned up incomplete files for user: ${userId}`);
    } catch (err) {
      console.warn('Could not cleanup incomplete files:', err);
    }
  }

  async readFileFromContainer(userId: string, filePath: string): Promise<string> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) throw new Error('Container not found');

    console.log(`📖 [DEBUG] readFileFromContainer - User: ${userId}, Path: ${filePath}`);

    let cleanPath: string = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    cleanPath = cleanPath.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    
    console.log(`📖 [DEBUG] readFileFromContainer - Clean path: ${cleanPath}`);
    
    const exec = await container.exec({
      Cmd: ['cat', `/workspace/${cleanPath}`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false
    });

    const stream = await exec.start({ 
      hijack: true, 
      stdin: false,
      Tty: false 
    });
    
    let output: string = '';
    let error: string = '';
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        const data: string = chunk.toString();
        console.log(`📖 [DEBUG] readFileFromContainer - Data chunk: ${data.substring(0, 100)}`);
        
        if (data.includes('No such file or directory') || data.includes('cannot access')) {
          error += data;
        } else {
          output += data;
        }
      });
      
      stream.on('error', (err) => {
        console.error(`❌ [ERROR] readFileFromContainer - Stream error:`, err);
        reject(err);
      });
      
      stream.on('end', async () => {
        try {
          const inspect = await exec.inspect();
          console.log(`📖 [DEBUG] readFileFromContainer - Exit code: ${inspect.ExitCode}`);
          
          if (inspect.ExitCode === 0 && !error) {
            // Clean output but preserve formatting
            let cleanedOutput: string = output;
            cleanedOutput = cleanedOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // Remove ANSI codes only
            
            console.log(`📖 [DEBUG] readFileFromContainer - Success, content length: ${cleanedOutput.length}`);
            resolve(cleanedOutput);
          } else {
            console.error(`❌ [ERROR] readFileFromContainer - File not found or error: ${error}`);
            reject(new Error(`File not found: ${cleanPath}`));
          }
        } catch (err) {
          console.error(`❌ [ERROR] readFileFromContainer - Inspect error:`, err);
          reject(err);
        }
      });
    });
  }

  async executeCommand(userId: string, command: string): Promise<Readable | null> {
    const shell = this.userShells.get(userId);
    if (!shell) {
      return null;
    }

    try {
      shell.write(command + '\n');
      return shell as Readable;
    } catch (err: unknown) {
      throw new Error(`Command execution failed: ${(err as Error).message}`);
    }
  }

  async sendToShell(userId: string, data: string): Promise<void> {
    const shell = this.userShells.get(userId);
    if (shell) {
      shell.write(data);
    }
  }

  async listFiles(userId: string): Promise<string[]> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) return [];

    const exec = await container.exec({
      Cmd: ['ls', '-la', '/workspace'],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false
    });

    const stream = await exec.start({ 
      hijack: true, 
      stdin: false,
      Tty: false 
    });
    
    let output: string = '';
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      
      stream.on('error', reject);
      
      stream.on('end', async () => {
        try {
          const lines: string[] = output.trim().split('\n').slice(1);
          const result: string[] = [];
          
          for (const line of lines) {
            const parts: string[] = line.trim().split(/\s+/);
            if (parts.length < 9) continue;
            
            const permissions: string = parts[0] ?? '';
            if (!permissions) continue;
            
            const isDir: boolean = permissions.charAt(0) === 'd';
            const name: string = parts.slice(8).join(' ');
            
            if (name && !name.startsWith('.') && name !== '..' && name !== 'workspace') {
              // FIXED: Only filter out files with single letter extensions that are clearly incomplete
              // Keep valid files like .js, .ts, .py, .c, .go etc.
              if (name.includes('.')) {
                const ext = name.split('.').pop();
                if (ext && ext.length === 1 && !['c', 'r', 'go', 'h'].includes(ext)) {
                  console.log(`🚫 [DEBUG] Filtering incomplete file: ${name}`);
                  continue;
                }
              }
              result.push(`${name}|${isDir ? 'd' : 'f'}`);
            }
          }
          
          console.log(`📁 [DEBUG] listFiles result for user ${userId}:`, result);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async listDirectory(userId: string, directoryPath: string): Promise<string[]> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) {
      return [];
    }

    let cleanPath: string = directoryPath || '';
    cleanPath = cleanPath.replace(/^\/+/, '');
    cleanPath = cleanPath.replace(/\/+$/, '');
    
    const fullPath: string = cleanPath ? `/workspace/${cleanPath}` : '/workspace';

    const exec = await container.exec({
      Cmd: ['ls', '-la', fullPath],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false
    });

    const stream = await exec.start({ 
      hijack: true, 
      stdin: false,
      Tty: false 
    });
    
    let output: string = '';
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      
      stream.on('error', (err: Error) => {
        console.error('Stream error in listDirectory:', err);
        reject(err);
      });
      
      stream.on('end', async () => {
        try {
          const lines: string[] = output.trim().split('\n');
          if (lines.length <= 1) {
            resolve([]);
            return;
          }
          
          const result: string[] = [];
          const fileLines: string[] = lines.slice(1);
          
          for (const line of fileLines) {
            if (!line.trim()) continue;
            
            const parts: string[] = line.trim().split(/\s+/);
            if (parts.length < 9) continue;
            
            const permissions: string = parts[0] ?? '';
            if (!permissions) continue;
            
            const isDir: boolean = permissions.charAt(0) === 'd';
            const name: string = parts.slice(8).join(' ');
            
            if (name && !name.startsWith('.') && name !== '..') {
              // FIXED: Same filtering logic as listFiles
              if (name.includes('.')) {
                const ext = name.split('.').pop();
                if (ext && ext.length === 1 && !['c', 'r', 'go', 'h'].includes(ext)) {
                  console.log(`🚫 [DEBUG] Filtering incomplete file: ${name}`);
                  continue;
                }
              }
              result.push(`${name}|${isDir ? 'd' : 'f'}`);
            }
          }
          
          console.log(`📁 [DEBUG] listDirectory result for ${directoryPath}:`, result);
          resolve(result);
        } catch (err) {
          console.error('Error parsing directory listing:', err);
          reject(err);
        }
      });
    });
  }

  async createDirectory(userId: string, path: string): Promise<void> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) {
      throw new Error('Container not found');
    }

    const exec = await container.exec({
      Cmd: ['mkdir', '-p', `/workspace/${path}`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: '0'
    });

    const stream = await exec.start({ hijack: true, stdin: false, Tty: false });
    
    return new Promise((resolve, reject) => {
      let error: string = '';
      
      stream.on('data', (chunk: Buffer) => {
        const data: string = chunk.toString();
        if (data.includes('Permission denied') || data.includes('cannot create')) {
          error += data;
        }
      });
      
      stream.on('end', async () => {
        try {
          const inspect = await exec.inspect();
          
          if (inspect.ExitCode === 0 && !error) {
            try {
              const chmodExec = await container.exec({
                Cmd: ['chmod', '-R', '755', `/workspace/${path}`],
                AttachStdout: true,
                AttachStderr: true,
                Tty: false,
                User: '0'
              });
              await chmodExec.start({ hijack: true, stdin: false, Tty: false });
            } catch (chmodError) {
              console.warn('Could not fix directory permissions:', chmodError);
            }
            resolve();
          } else {
            reject(new Error(`Directory creation failed: ${error}`));
          }
        } catch (err) {
          reject(err);
        }
      });
      
      stream.on('error', reject);
    });
  }

  async renamePath(userId: string, oldPath: string, newPath: string): Promise<void> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) {
      throw new Error('Container not found');
    }

    const exec = await container.exec({
      Cmd: ['mv', `/workspace/${oldPath}`, `/workspace/${newPath}`],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false
    });

    const stream = await exec.start({ 
      hijack: true, 
      stdin: false,
      Tty: false 
    });
    
    return new Promise((resolve, reject) => {
      let output: string = '';
      let error: string = '';
      
      stream.on('data', (chunk: Buffer) => {
        const data: string = chunk.toString();
        if (data.includes('No such file or directory') || data.includes('cannot move')) {
          error += data;
        } else {
          output += data;
        }
      });
      
      stream.on('end', async () => {
        try {
          const inspect = await exec.inspect();
          
          if (inspect.ExitCode === 0 && !error) {
            resolve();
          } else {
            reject(new Error(`Rename failed: ${error || output}`));
          }
        } catch (err) {
          reject(err);
        }
      });
      
      stream.on('error', reject);
    });
  }

  async deletePath(userId: string, path: string): Promise<void> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) return;

    const exec = await container.exec({
      Cmd: ['rm', '-rf', `/workspace/${path}`],
      AttachStdout: true,
      Tty: false
    });

    const stream = await exec.start({ hijack: true, stdin: false, Tty: false });
    await new Promise<void>((resolve) => stream.on('end', resolve));
  }

  async cleanupContainer(userId: string): Promise<void> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    const shell = this.userShells.get(userId);

    if (shell) {
      try {
        shell.end();
      } catch (err) {
        // Silently handle errors
      }
      this.userShells.delete(userId);
    }

    if (!container) return;

    try {
      await container.stop();
      await container.remove();
      this.userContainers.delete(userId);
    } catch (err: any) {
      if (err.statusCode !== 409) {
        console.error('Error cleaning up container:', err);
      }
      this.userContainers.delete(userId);
    }
  }
}
