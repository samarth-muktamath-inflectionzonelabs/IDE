import { DockerManager } from '../Docker/DockerManager.js';
import { CloudStorageService } from './CloudStorageService.js';
import { Readable } from 'stream';

export class ContainerService {
  public dockerManager: DockerManager = new DockerManager();
  private cloudStorage: CloudStorageService = new CloudStorageService();

  async initialize(): Promise<void> {
    console.log('🚀 [Service] =================== SERVICE INITIALIZE START ===================');
    
    // Initialize Docker
    console.log('🚀 [Service] Initializing Docker...');
    await this.dockerManager.buildUserImage();
    console.log('✅ [Service] Docker initialized');
    
    // Initialize Cloud Storage immediately (not with delay)
    console.log('🚀 [Service] Initializing Cloud Storage...');
    try {
      await this.cloudStorage.initialize();
      console.log('✅ [Service] Cloud storage initialized successfully');
    } catch (error) {
      console.error('❌ [Service] Cloud storage initialization failed:', error);
      console.warn('⚠️ [Service] Continuing without cloud storage');
    }
    
    // Test cloud connection
    console.log('🚀 [Service] Testing cloud connection...');
    const cloudConnected = await this.cloudStorage.testConnection();
    console.log(`🔍 [Service] Cloud connection test result: ${cloudConnected}`);
    
    console.log('✅ [Service] =================== SERVICE INITIALIZE COMPLETE ===================');
  }

  async createDirectory(userId: string, dirPath: string): Promise<void> {
    console.log(`\n🔧 [Service] =================== CREATE DIRECTORY START ===================`);
    console.log(`🔧 [Service] User ID: ${userId}`);
    console.log(`🔧 [Service] Directory Path: ${dirPath}`);
    
    try {
      // Create in Docker container
      console.log(`🔧 [Service] Creating directory in Docker container...`);
      await this.dockerManager.createDirectory(userId, dirPath);
      console.log(`✅ [Service] Directory created in container: ${dirPath}`);
      
      // IMMEDIATELY create in cloud storage with placeholder
      console.log(`🔧 [Service] Creating directory in cloud storage...`);
      const cloudSuccess = await this.cloudStorage.createEmptyDirectory(userId, dirPath);
      
      if (cloudSuccess) {
        console.log(`✅ [Service] Empty directory created in cloud: ${dirPath}`);
      } else {
        console.warn(`⚠️ [Service] Cloud directory creation failed: ${dirPath}`);
      }
      
      console.log(`✅ [Service] =================== CREATE DIRECTORY SUCCESS ===================\n`);
    } catch (error) {
      console.error(`❌ [Service] =================== CREATE DIRECTORY FAILED ===================`);
      console.error(`❌ [Service] Directory creation failed for ${dirPath}:`, error);
      console.error(`❌ [Service] =================== CREATE DIRECTORY FAILED ===================\n`);
      throw error;
    }
  }

  // Rest of your existing methods...
  async createUserSession(userId: string): Promise<void> {
    console.log(`🔄 [Service] Creating session for user: ${userId}`);
    
    await this.dockerManager.createUserContainer(userId);
    console.log(`✅ [Service] Docker container created for: ${userId}`);
    
    await this.restoreUserFiles(userId);
    console.log(`✅ [Service] Session created for: ${userId}`);
  }

  private async restoreUserFiles(userId: string): Promise<void> {
    try {
      console.log(`🔄 [Service] Restoring files for user: ${userId}`);
      
      const cloudFiles = await this.cloudStorage.restoreAllUserFiles(userId);
      
      if (cloudFiles.size === 0) {
        console.log(`ℹ️ [Service] No files to restore for user: ${userId}`);
        return;
      }
      
      for (const [filePath, content] of cloudFiles) {
        try {
          await this.dockerManager.writeFileToContainer(userId, filePath, content);
          console.log(`✅ [Service] Restored file: ${filePath}`);
        } catch (error) {
          console.error(`❌ [Service] Failed to restore file ${filePath}:`, error);
        }
      }
      
      console.log(`✅ [Service] Restored ${cloudFiles.size} files for user: ${userId}`);
    } catch (error) {
      console.error(`❌ [Service] File restoration failed for user ${userId}:`, error);
    }
  }

  async handleFileChange(userId: string, filePath: string, content: string): Promise<void> {
    console.log(`🔄 [Service] Handling file change: ${userId}/${filePath}`);
    
    try {
      await this.dockerManager.writeFileToContainer(userId, filePath, content);
      console.log(`✅ [Service] File saved to container: ${filePath}`);
      
      this.cloudStorage.saveFile(userId, filePath, content)
        .then((success) => {
          if (success) {
            console.log(`✅ [Service] File saved to cloud: ${filePath}`);
          } else {
            console.warn(`⚠️ [Service] Cloud save failed: ${filePath}`);
          }
        })
        .catch((error) => {
          console.error(`❌ [Service] Cloud save error for ${filePath}:`, error);
        });
      
      console.log(`✅ [Service] File change handled: ${filePath}`);
    } catch (error) {
      console.error(`❌ [Service] File change failed for ${filePath}:`, error);
      throw error;
    }
  }

  async deleteUserDirectory(userId: string, dirPath: string): Promise<void> {
    try {
      console.log(`🔄 [Service] Deleting directory: ${userId}/${dirPath}`);
      
      await this.dockerManager.deletePath(userId, dirPath);
      console.log(`✅ [Service] Directory deleted from container: ${dirPath}`);
      
      const cloudDeleted = await this.cloudStorage.deleteDirectory(userId, dirPath);
      if (cloudDeleted) {
        console.log(`✅ [Service] Directory deleted from cloud: ${dirPath}`);
      } else {
        console.warn(`⚠️ [Service] Cloud directory delete failed: ${dirPath}`);
      }
      
      console.log(`✅ [Service] Directory deletion completed: ${dirPath}`);
    } catch (error) {
      console.error(`❌ [Service] Directory deletion failed for ${dirPath}:`, error);
      throw error;
    }
  }

  async backupUserFiles(userId: string): Promise<void> {
    try {
      console.log(`🔄 [Service] Starting backup for user: ${userId}`);
      
      const fileList = await this.dockerManager.listFiles(userId);
      const containerFiles = new Map<string, string>();
      
      for (const fileItem of fileList) {
        const parts = fileItem.split('|');
        const fileName = parts[0];
        const fileType = parts[1];
        
        if (!fileName || !fileType) {
          console.warn(`⚠️ [Service] Invalid file item format: ${fileItem}`);
          continue;
        }
        
        if (fileType === 'f') {
          try {
            const content = await this.dockerManager.readFileFromContainer(userId, fileName);
            containerFiles.set(fileName, content);
          } catch (error) {
            console.warn(`⚠️ [Service] Could not read file ${fileName} for backup:`, error);
          }
        }
      }
      
      const savedCount = await this.cloudStorage.backupAllUserFiles(userId, containerFiles);
      console.log(`✅ [Service] Backup completed: ${savedCount}/${containerFiles.size} files saved to cloud`);
      
    } catch (error) {
      console.error(`❌ [Service] Backup failed for user ${userId}:`, error);
    }
  }

  async deleteUserFile(userId: string, filePath: string): Promise<void> {
    try {
      console.log(`🔄 [Service] Deleting file: ${userId}/${filePath}`);
      
      await this.dockerManager.deletePath(userId, filePath);
      console.log(`✅ [Service] File deleted from container: ${filePath}`);
      
      const cloudDeleted = await this.cloudStorage.deleteFile(userId, filePath);
      if (cloudDeleted) {
        console.log(`✅ [Service] File deleted from cloud: ${filePath}`);
      } else {
        console.warn(`⚠️ [Service] Cloud delete failed: ${filePath}`);
      }
      
      console.log(`✅ [Service] File deletion completed: ${filePath}`);
    } catch (error) {
      console.error(`❌ [Service] File deletion failed for ${filePath}:`, error);
      throw error;
    }
  }

  async getHealthStatus(): Promise<any> {
    return {
      docker: {
        status: 'healthy'
      },
      cloud: {
        status: this.cloudStorage.isHealthy() ? 'healthy' : 'unhealthy',
        connected: this.cloudStorage.isHealthy()
      }
    };
  }

  async handleTerminalCommand(userId: string, command: string, callback: (data: string) => void): Promise<void> {
    try {
      const stream = await this.dockerManager.executeCommand(userId, command);
      if (!stream) {
        callback('No active container found');
        return;
      }
      stream.on('data', (chunk: Buffer) => {
        callback(chunk.toString());
      });
      stream.on('error', (error: Error) => {
        callback(`Stream error: ${error.message}`);
      });
    } catch (err: unknown) {
      callback(`Error: ${(err as Error).message}\n`);
    }
  }

  async sendTerminalData(userId: string, data: string): Promise<void> {
    await this.dockerManager.sendToShell(userId, data);
  }

  public async executeCommand(userId: string, command: string): Promise<Readable | null> {
    return this.dockerManager.executeCommand(userId, command);
  }

  async getFiles(userId: string): Promise<string[]> {
    return await this.dockerManager.listFiles(userId);
  }

  async readFileFromContainer(userId: string, filePath: string): Promise<string> {
    try {
      return await this.dockerManager.readFileFromContainer(userId, filePath);
    } catch (error) {
      console.log(`📁 [Service] File not in container, trying cloud: ${filePath}`);
      const content = await this.cloudStorage.loadFile(userId, filePath);
      if (content !== null) {
        return content;
      }
      throw new Error(`File not found: ${filePath}`);
    }
  }

  async cleanupUserSession(userId: string): Promise<void> {
    console.log(`🔄 [Service] Cleaning up session for user: ${userId}`);
    
    await this.backupUserFiles(userId);
    await this.dockerManager.cleanupContainer(userId);
    
    console.log(`✅ [Service] Session cleanup completed for user: ${userId}`);
  }
}
