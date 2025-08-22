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

  // COMPLETE FIX: Extension fixing with all programming languages
  private fixIncompleteExtension(filePath: string): string {
    console.log(`🔧 [DEBUG] Checking extension for: "${filePath}"`);
    
    const extensionMap: { [key: string]: string } = {
      '.j': '.js',
      '.t': '.ts', 
      '.p': '.py',
      '.c': '.cpp',
      '.h': '.hpp',
      '.ja': '.java',
      '.ph': '.php',
      '.r': '.rb',
      '.g': '.go',
      '.ru': '.rust',
      '.sw': '.swift',
      '.k': '.kt',
      '.s': '.sh',
      '.ht': '.html',
      '.cs': '.css',
      '.jso': '.json',
      '.x': '.xml',
      '.m': '.md',
      '.y': '.yml',
      '.do': '.dockerfile'
    };

    for (const [incomplete, complete] of Object.entries(extensionMap)) {
      if (filePath.endsWith(incomplete) && !filePath.endsWith(complete)) {
        const fixedPath = filePath.replace(incomplete, complete);
        console.log(`🔧 [DEBUG] EXTENSION FIXED: "${filePath}" -> "${fixedPath}"`);
        return fixedPath;
      }
    }

    console.log(`🔧 [DEBUG] NO EXTENSION FIX NEEDED: "${filePath}"`);
    return filePath;
  }

  // COMPLETE FIX: Ultra-aggressive content cleaning
  private ultraCleanContent(content: string, filePath: string = ''): string {
    console.log(`🧽 [DEBUG] Ultra-cleaning content for: ${filePath}`);
    console.log(`🧽 [DEBUG] Original length: ${content.length}`);
    
    if (!content) return '';
    
    let cleaned = content;
    
    // Log original bytes for debugging
    const originalBytes = Buffer.from(cleaned, 'utf8');
    console.log(`🧽 [DEBUG] Original bytes (first 20): ${Array.from(originalBytes.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' ')}`);
    
    // Step 1: Keep ONLY safe ASCII characters + \n + \t
    cleaned = cleaned.replace(/[^\x20-\x7E\x09\x0A]/g, '');
    
    // Step 2: Remove any remaining control characters
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\xFF]/g, '');
    
    // Step 3: Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // Step 4: Special handling for JSON files
    if (filePath.includes('.json') || filePath.includes('package')) {
      try {
        console.log(`🧽 [DEBUG] JSON file detected, validating...`);
        const parsed = JSON.parse(cleaned);
        cleaned = JSON.stringify(parsed, null, 2);
        console.log(`🧽 [DEBUG] JSON validated and reformatted`);
      } catch (jsonError) {
        console.log(`🧽 [DEBUG] JSON invalid, creating safe default`);
        if (filePath.includes('package.json')) {
          cleaned = JSON.stringify({
            "name": "test",
            "version": "1.0.0",
            "main": "index.js",
            "type": "module",
            "scripts": {
              "test": "echo \"Error: no test specified\" && exit 1"
            },
            "keywords": [],
            "author": "",
            "license": "ISC",
            "description": ""
          }, null, 2);
        } else {
          cleaned = '{}';
        }
      }
    }
    
    console.log(`🧽 [DEBUG] Cleaning complete: ${content.length} -> ${cleaned.length}`);
    return cleaned;
  }

  async buildUserImage(): Promise<void> {
    console.log('🏗️ [DEBUG] Building user environment image...');
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
          if (err) {
            console.error('❌ [ERROR] Build failed:', err);
            return reject(err);
          }
          stream?.on('data', (data: Buffer) => process.stdout.write(data.toString()));
          stream?.on('end', () => {
            console.log('✅ [DEBUG] Build completed');
            resolve();
          });
          stream?.on('error', reject);
        }
      );
    });
  }

  async createUserContainer(userId: string): Promise<Docker.Container> {
    console.log(`🐳 [DEBUG] Creating container for user: ${userId}`);
    
    const hostPath: string = path.resolve(process.cwd(), 'user');
    console.log(`🐳 [DEBUG] Host path: ${hostPath}`);
    
    try {
      await fs.stat(hostPath);
    } catch (error) {
      await fs.mkdir(hostPath, { recursive: true });
    }
    
    try {
      await fs.chmod(hostPath, 0o755);
    } catch (error) {
      console.warn('⚠️ [WARNING] Could not set permissions:', error);
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
       ExposedPorts: {
    '3000/tcp': {} },
      HostConfig: {
        Memory: 536870912,
        CpuShares: 512,
        AutoRemove: true,
        Binds: [`${hostPath}:/workspace:rw`]
      }
    });

    await container.start();
    this.userContainers.set(userId, container);
    console.log(`✅ [DEBUG] Container started: ${userId}`);

    try {
      const exec = await container.exec({
        Cmd: ['chmod', '-R', '755', '/workspace'],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false
      });
      await exec.start({ hijack: true, stdin: false, Tty: false });
    } catch (error) {
      console.warn('⚠️ [WARNING] Permission fix failed:', error);
    }

    await this.createPersistentShell(userId);
    return container;
  }

  async createPersistentShell(userId: string): Promise<void> {
    console.log(`🐚 [DEBUG] Creating shell for user: ${userId}`);
    
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
      console.log(`✅ [DEBUG] Shell created: ${userId}`);

      setTimeout(() => {
        stream.write('\ncd /workspace\n');
        stream.write("export PS1='\\w$ '\n");
        stream.write('clear\n');
      }, 100);

    } catch (err) {
      console.error(`❌ [ERROR] Shell creation failed for ${userId}:`, err);
    }
  }

  getContainer(userId: string): Docker.Container | undefined {
    return this.userContainers.get(userId);
  }

  async writeFileToContainer(userId: string, filePath: string, content: string): Promise<void> {
    console.log(`\n🔧 [DEBUG] =================== WRITE FILE START ===================`);
    console.log(`🔧 [DEBUG] User: ${userId}`);
    console.log(`🔧 [DEBUG] File: ${filePath}`);
    console.log(`🔧 [DEBUG] Content Length: ${content.length}`);
    
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) {
      console.error(`❌ [ERROR] Container not found: ${userId}`);
      throw new Error('Container not found');
    }

    // Fix extension
    const fixedPath = this.fixIncompleteExtension(filePath);
    console.log(`🔧 [DEBUG] Fixed Path: ${fixedPath}`);

    // Ultra-clean content
    const cleanContent = this.ultraCleanContent(content, fixedPath);
    console.log(`🔧 [DEBUG] Content cleaned: ${content.length} -> ${cleanContent.length}`);

    // Create clean buffer
    const contentBuffer = Buffer.from(cleanContent, 'utf8');
    console.log(`🔧 [DEBUG] Buffer size: ${contentBuffer.length} bytes`);

    // Create TAR with clean path
    const cleanFilePath = fixedPath.startsWith('/') ? fixedPath.slice(1) : fixedPath;
    const pack = tar.pack();
    
    pack.entry({ 
      name: cleanFilePath,
      size: contentBuffer.length,
      mode: 0o644,
      type: 'file'
    }, contentBuffer, (err) => {
      if (err) {
        console.error(`❌ [ERROR] TAR entry failed:`, err);
        throw err;
      }
    });
    
    pack.finalize();

    try {
      console.log(`🚀 [DEBUG] Uploading to container...`);
      await container.putArchive(pack, { path: '/workspace' });
      console.log(`✅ [DEBUG] Upload successful`);
      
      // Sync filesystem
      try {
        const syncExec = await container.exec({
          Cmd: ['sync'],
          AttachStdout: false,
          AttachStderr: false
        });
        await syncExec.start({ hijack: false });
        console.log(`✅ [DEBUG] Sync completed`);
      } catch (syncErr) {
        console.warn('⚠️ [WARNING] Sync failed:', syncErr);
      }
      
    } catch (archiveError: unknown) {
      console.error(`❌ [ERROR] Upload failed:`, archiveError);
      
      if (archiveError instanceof Error) {
        console.error(`❌ [ERROR] Details: ${archiveError.message}`);
      }
      
      throw new Error(`File upload failed: ${archiveError instanceof Error ? archiveError.message : 'Unknown error'}`);
    }
    
    console.log(`🔧 [DEBUG] =================== WRITE FILE SUCCESS ===================\n`);
  }

  async cleanupDuplicateFiles(userId: string): Promise<void> {
    console.log(`🧹 [DEBUG] Cleaning duplicates for user: ${userId}`);
    
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) return;

    try {
      const incompleteExtensions = ['.j', '.t', '.p', '.c', '.h', '.ja', '.ph', '.r', '.g', '.ru', '.sw', '.k', '.s', '.ht', '.cs', '.jso', '.x', '.m', '.y', '.do'];
      
      for (const ext of incompleteExtensions) {
        try {
          const exec = await container.exec({
            Cmd: ['find', '/workspace', '-name', `*${ext}`, '-type', 'f', 
                  '!', '-name', '*.js', '!', '-name', '*.ts', '!', '-name', '*.py', 
                  '!', '-name', '*.cpp', '!', '-name', '*.hpp', '!', '-name', '*.java',
                  '!', '-name', '*.php', '!', '-name', '*.rb', '!', '-name', '*.go',
                  '!', '-name', '*.rust', '!', '-name', '*.swift', '!', '-name', '*.kt',
                  '!', '-name', '*.sh', '!', '-name', '*.html', '!', '-name', '*.css',
                  '!', '-name', '*.json', '!', '-name', '*.xml', '!', '-name', '*.md',
                  '!', '-name', '*.yml', '!', '-name', '*.dockerfile', '-delete'],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false
          });
          await exec.start({ hijack: true, stdin: false, Tty: false });
        } catch (err) {
          console.warn(`⚠️ [WARNING] Could not cleanup ${ext}:`, err);
        }
      }
      
      console.log(`✅ [DEBUG] Cleanup completed: ${userId}`);
    } catch (err) {
      console.error(`❌ [ERROR] Cleanup failed: ${userId}`, err);
    }
  }

  async readFileFromContainer(userId: string, filePath: string): Promise<string> {
    console.log(`\n📖 [DEBUG] =================== READ FILE START ===================`);
    console.log(`📖 [DEBUG] User: ${userId}, Path: ${filePath}`);
    
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) throw new Error('Container not found');

    const fixedPath = this.fixIncompleteExtension(filePath);
    let cleanPath: string = fixedPath.startsWith('/') ? fixedPath.slice(1) : fixedPath;
    cleanPath = cleanPath.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    
    console.log(`📖 [DEBUG] Clean path: ${cleanPath}`);
    
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
        
        if (data.includes('No such file or directory') || data.includes('cannot access')) {
          error += data;
        } else {
          output += data;
        }
      });
      
      stream.on('error', reject);
      
      stream.on('end', async () => {
        try {
          const inspect = await exec.inspect();
          
          if (inspect.ExitCode === 0 && !error) {
            let cleanedOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
            cleanedOutput = this.ultraCleanContent(cleanedOutput, filePath);
            
            console.log(`📖 [DEBUG] Read successful - Length: ${cleanedOutput.length}`);
            console.log(`📖 [DEBUG] =================== READ FILE SUCCESS ===================\n`);
            
            resolve(cleanedOutput);
          } else {
            console.error(`❌ [ERROR] Read failed: ${error}`);
            reject(new Error(`File not found: ${cleanPath}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async executeCommand(userId: string, command: string): Promise<Readable | null> {
    console.log(`⚡ [DEBUG] Command: ${userId} -> ${command}`);
    const shell = this.userShells.get(userId);
    if (!shell) return null;

    try {
      shell.write(command + '\n');
      return shell as Readable;
    } catch (err: unknown) {
      throw new Error(`Command failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  async sendToShell(userId: string, data: string): Promise<void> {
    const shell = this.userShells.get(userId);
    if (shell) {
      shell.write(data);
    }
  }

  async listFiles(userId: string): Promise<string[]> {
    console.log(`📁 [DEBUG] Listing files: ${userId}`);
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
              if (name.includes('.')) {
                const ext = name.split('.').pop();
                const validSingleExtensions = ['c', 'r', 'go', 'h', 'm', 'd', 's', 'f', 'v', 'l', 'y'];
                if (ext && ext.length === 1 && !validSingleExtensions.includes(ext)) {
                  continue;
                }
              }
              result.push(`${name}|${isDir ? 'd' : 'f'}`);
            }
          }
          
          console.log(`📁 [DEBUG] Files found: ${result.length}`);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async listDirectory(userId: string, directoryPath: string): Promise<string[]> {
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) return [];

    let cleanPath: string = directoryPath || '';
    cleanPath = cleanPath.replace(/^\/+/, '').replace(/\/+$/, '');
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
      
      stream.on('error', reject);
      
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
              if (name.includes('.')) {
                const ext = name.split('.').pop();
                const validSingleExtensions = ['c', 'r', 'go', 'h', 'm', 'd', 's', 'f', 'v', 'l', 'y'];
                if (ext && ext.length === 1 && !validSingleExtensions.includes(ext)) {
                  continue;
                }
              }
              result.push(`${name}|${isDir ? 'd' : 'f'}`);
            }
          }
          
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async createDirectory(userId: string, path: string): Promise<void> {
    console.log(`📁 [DEBUG] Creating directory: ${userId} -> ${path}`);
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    if (!container) throw new Error('Container not found');

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
              console.warn('Permission fix failed:', chmodError);
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
    if (!container) throw new Error('Container not found');

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
    console.log(`🧹 [DEBUG] Cleaning up container: ${userId}`);
    const container: Docker.Container | undefined = this.userContainers.get(userId);
    const shell = this.userShells.get(userId);

    if (shell) {
      try {
        shell.end();
      } catch (err) {
        // Ignore errors
      }
      this.userShells.delete(userId);
    }

    if (!container) return;

    try {
      await container.stop();
      await container.remove();
      this.userContainers.delete(userId);
    } catch (err: unknown) {
      const statusCode = (err as any)?.statusCode;
      if (statusCode !== 409) {
        console.error(`Cleanup error for ${userId}:`, err);
      }
      this.userContainers.delete(userId);
    }
  }
}
