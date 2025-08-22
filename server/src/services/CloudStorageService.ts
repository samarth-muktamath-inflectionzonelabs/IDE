import { Client as MinIOClient } from 'minio';

export class CloudStorageService {
  private client: MinIOClient;
  private bucketName: string = 'user-files';
  private isConnected: boolean = false;

  constructor() {
    console.log('🔧 [Cloud] CloudStorageService constructor called');
    console.log('🔧 [Cloud] Environment variables:');
    console.log('🔧 [Cloud] MINIO_ENDPOINT:', process.env.MINIO_ENDPOINT || 'minio');
    console.log('🔧 [Cloud] MINIO_ACCESS_KEY:', process.env.MINIO_ACCESS_KEY || 'minioadmin');
    
    this.client = new MinIOClient({
      endPoint: process.env.MINIO_ENDPOINT || 'minio',
      port: 9000,
      useSSL: false,
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin123',
    });
    
    console.log('🔧 [Cloud] MinIO client created');
  }

  async initialize(): Promise<void> {
    console.log('🔄 [Cloud] =================== INITIALIZE START ===================');
    
    try {
      console.log('🔄 [Cloud] Attempting MinIO connection...');
      
      // Test connection with retries
      let retries = 5;
      while (retries > 0) {
        try {
          console.log(`🔄 [Cloud] Connection attempt ${6 - retries}/5`);
          const buckets = await this.client.listBuckets();
          console.log(`✅ [Cloud] Connection successful! Found ${buckets.length} buckets`);
          this.isConnected = true;
          break;
        } catch (error) {
          console.error(`❌ [Cloud] Connection attempt ${6 - retries} failed:`, error);
          retries--;
          if (retries > 0) {
            console.log(`⏳ [Cloud] Waiting 2 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      if (!this.isConnected) {
        throw new Error('Failed to connect to MinIO after 5 attempts');
      }
      
      // Create bucket if not exists
      console.log(`🔄 [Cloud] Checking if bucket '${this.bucketName}' exists...`);
      const exists = await this.client.bucketExists(this.bucketName);
      
      if (!exists) {
        console.log(`🔄 [Cloud] Creating bucket '${this.bucketName}'...`);
        await this.client.makeBucket(this.bucketName);
        console.log(`✅ [Cloud] Bucket '${this.bucketName}' created successfully`);
      } else {
        console.log(`✅ [Cloud] Bucket '${this.bucketName}' already exists`);
      }
      
      console.log('✅ [Cloud] =================== INITIALIZE SUCCESS ===================');
    } catch (error) {
      console.error('❌ [Cloud] =================== INITIALIZE FAILED ===================');
      console.error('❌ [Cloud] MinIO initialization failed:', error);
      console.error('❌ [Cloud] =================== INITIALIZE FAILED ===================');
      this.isConnected = false;
      // Don't throw error, allow app to continue without cloud storage
    }
  }

  async createEmptyDirectory(userId: string, dirPath: string): Promise<boolean> {
    console.log(`\n📁 [Cloud] =================== CREATE DIRECTORY START ===================`);
    console.log(`📁 [Cloud] User ID: ${userId}`);
    console.log(`📁 [Cloud] Directory Path: ${dirPath}`);
    console.log(`📁 [Cloud] Is Connected: ${this.isConnected}`);
    
    if (!this.isConnected) {
      console.warn('⚠️ [Cloud] MinIO not connected, skipping directory creation');
      console.log('⚠️ [Cloud] =================== CREATE DIRECTORY SKIPPED ===================\n');
      return false;
    }

    try {
      // Create a hidden placeholder file to make empty directory exist in MinIO
      const placeholderPath = `${userId}/${dirPath}/.gitkeep`;
      const placeholderContent = '# Directory placeholder for MinIO storage\n# This file ensures empty directories persist\n# Created: ' + new Date().toISOString() + '\n';
      
      console.log(`🔄 [Cloud] Creating placeholder file: ${placeholderPath}`);
      console.log(`🔄 [Cloud] Placeholder content length: ${placeholderContent.length}`);
      
      const buffer = Buffer.from(placeholderContent, 'utf8');
      console.log(`🔄 [Cloud] Buffer created, size: ${buffer.length} bytes`);
      
      console.log(`🔄 [Cloud] Uploading to bucket: ${this.bucketName}`);
      await this.client.putObject(
        this.bucketName,
        placeholderPath,
        buffer,
        buffer.length,
        {
          'Content-Type': 'text/plain',
          'X-User-ID': userId,
          'X-Directory-Placeholder': 'true',
          'X-Created-Time': new Date().toISOString(),
        }
      );
      
      console.log(`✅ [Cloud] Empty directory created successfully: ${userId}/${dirPath}`);
      console.log(`✅ [Cloud] =================== CREATE DIRECTORY SUCCESS ===================\n`);
      return true;
    } catch (error) {
      console.error(`❌ [Cloud] =================== CREATE DIRECTORY FAILED ===================`);
      console.error(`❌ [Cloud] Empty directory creation failed for ${dirPath}:`, error);
      console.error(`❌ [Cloud] Error type:`, typeof error);
      console.error(`❌ [Cloud] Error details:`, error);
      console.error(`❌ [Cloud] =================== CREATE DIRECTORY FAILED ===================\n`);
      return false;
    }
  }

  // Add debug method to test connection
  async testConnection(): Promise<boolean> {
    console.log(`🔍 [Cloud] =================== CONNECTION TEST START ===================`);
    try {
      console.log(`🔍 [Cloud] Testing connection to MinIO...`);
      const buckets = await this.client.listBuckets();
      console.log(`✅ [Cloud] Connection test successful! Buckets: ${buckets.length}`);
      console.log(`✅ [Cloud] =================== CONNECTION TEST SUCCESS ===================`);
      return true;
    } catch (error) {
      console.error(`❌ [Cloud] =================== CONNECTION TEST FAILED ===================`);
      console.error(`❌ [Cloud] Connection test failed:`, error);
      console.error(`❌ [Cloud] =================== CONNECTION TEST FAILED ===================`);
      return false;
    }
  }

  async saveFile(userId: string, filePath: string, content: string): Promise<boolean> {
    console.log(`📄 [Cloud] Saving file: ${userId}/${filePath}, Connected: ${this.isConnected}`);
    if (!this.isConnected) return false;

    try {
      const objectName = `${userId}/${filePath}`;
      const buffer = Buffer.from(content, 'utf8');
      
      await this.client.putObject(
        this.bucketName,
        objectName,
        buffer,
        buffer.length,
        {
          'Content-Type': this.getContentType(filePath),
          'X-User-ID': userId,
          'X-Upload-Time': new Date().toISOString(),
        }
      );
      
      console.log(`✅ [Cloud] File saved successfully: ${objectName}`);
      return true;
    } catch (error) {
      console.error(`❌ [Cloud] Save failed for ${filePath}:`, error);
      return false;
    }
  }

  async loadFile(userId: string, filePath: string): Promise<string | null> {
    console.log(`📖 [Cloud] Loading file: ${userId}/${filePath}, Connected: ${this.isConnected}`);
    if (!this.isConnected) return null;

    try {
      const objectName = `${userId}/${filePath}`;
      const stream = await this.client.getObject(this.bucketName, objectName);
      
      let content = '';
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
          content += chunk.toString();
        });
        stream.on('end', () => {
          console.log(`✅ [Cloud] File loaded successfully: ${objectName}`);
          resolve(content);
        });
        stream.on('error', (error) => {
          console.error(`❌ [Cloud] Load failed for ${objectName}:`, error);
          resolve(null);
        });
      });
    } catch (error) {
      console.error(`❌ [Cloud] Load failed for ${filePath}:`, error);
      return null;
    }
  }

  async deleteFile(userId: string, filePath: string): Promise<boolean> {
    console.log(`🗑️ [Cloud] Deleting file: ${userId}/${filePath}, Connected: ${this.isConnected}`);
    if (!this.isConnected) return false;

    try {
      const objectName = `${userId}/${filePath}`;
      await this.client.removeObject(this.bucketName, objectName);
      console.log(`✅ [Cloud] File deleted successfully: ${objectName}`);
      return true;
    } catch (error) {
      console.error(`❌ [Cloud] Delete failed for ${filePath}:`, error);
      return false;
    }
  }

  async deleteDirectory(userId: string, dirPath: string): Promise<boolean> {
    console.log(`🗑️ [Cloud] Deleting directory: ${userId}/${dirPath}, Connected: ${this.isConnected}`);
    if (!this.isConnected) return false;

    try {
      const objectsToDelete: string[] = [];
      const stream = this.client.listObjects(this.bucketName, `${userId}/${dirPath}/`, true);
      
      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            objectsToDelete.push(obj.name);
          }
        });
        
        stream.on('end', async () => {
          try {
            if (objectsToDelete.length > 0) {
              await this.client.removeObjects(this.bucketName, objectsToDelete);
              console.log(`✅ [Cloud] Directory deleted successfully: ${userId}/${dirPath} (${objectsToDelete.length} objects)`);
            } else {
              console.log(`✅ [Cloud] Directory was already empty: ${userId}/${dirPath}`);
            }
            resolve(true);
          } catch (error) {
            console.error(`❌ [Cloud] Directory deletion failed:`, error);
            resolve(false);
          }
        });
        
        stream.on('error', (error) => {
          console.error(`❌ [Cloud] Directory listing failed:`, error);
          resolve(false);
        });
      });
    } catch (error) {
      console.error(`❌ [Cloud] Directory deletion failed for ${dirPath}:`, error);
      return false;
    }
  }

  async listUserFiles(userId: string): Promise<string[]> {
    console.log(`📋 [Cloud] Listing files for user: ${userId}, Connected: ${this.isConnected}`);
    if (!this.isConnected) return [];

    try {
      const objects: string[] = [];
      const stream = this.client.listObjects(this.bucketName, `${userId}/`, true);
      
      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            const fileName = obj.name.replace(`${userId}/`, '');
            if (!fileName.endsWith('.gitkeep')) {
              objects.push(fileName);
            }
          }
        });
        stream.on('end', () => {
          console.log(`✅ [Cloud] Listed ${objects.length} files for user: ${userId}`);
          resolve(objects);
        });
        stream.on('error', (error) => {
          console.error(`❌ [Cloud] List failed for user ${userId}:`, error);
          resolve([]);
        });
      });
    } catch (error) {
      console.error(`❌ [Cloud] List failed for user ${userId}:`, error);
      return [];
    }
  }

  async backupAllUserFiles(userId: string, containerFiles: Map<string, string>): Promise<number> {
    console.log(`💾 [Cloud] Starting backup for user ${userId} (${containerFiles.size} files), Connected: ${this.isConnected}`);
    if (!this.isConnected) return 0;

    let savedCount = 0;
    for (const [filePath, content] of containerFiles) {
      if (!filePath.endsWith('.gitkeep')) {
        const success = await this.saveFile(userId, filePath, content);
        if (success) savedCount++;
      }
    }
    
    console.log(`✅ [Cloud] Backup completed: ${savedCount}/${containerFiles.size} files saved`);
    return savedCount;
  }

  async restoreAllUserFiles(userId: string): Promise<Map<string, string>> {
    console.log(`🔄 [Cloud] Starting restore for user: ${userId}, Connected: ${this.isConnected}`);
    if (!this.isConnected) return new Map();

    try {
      const files = new Map<string, string>();
      const allObjects: string[] = [];
      const stream = this.client.listObjects(this.bucketName, `${userId}/`, true);
      
      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          if (obj.name) {
            const fileName = obj.name.replace(`${userId}/`, '');
            allObjects.push(fileName);
          }
        });
        
        stream.on('end', async () => {
          for (const filePath of allObjects) {
            if (filePath.endsWith('.gitkeep')) {
              const dirPath = filePath.replace('/.gitkeep', '');
              console.log(`📁 [Cloud] Directory structure noted: ${dirPath}`);
            } else {
              const content = await this.loadFile(userId, filePath);
              if (content !== null) {
                files.set(filePath, content);
              }
            }
          }
          
          console.log(`✅ [Cloud] Restored ${files.size} files for user: ${userId}`);
          resolve(files);
        });
        
        stream.on('error', (error) => {
          console.error(`❌ [Cloud] Restore failed for user ${userId}:`, error);
          resolve(new Map());
        });
      });
    } catch (error) {
      console.error(`❌ [Cloud] Restore failed for user ${userId}:`, error);
      return new Map();
    }
  }

  private getContentType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'json': 'application/json',
      'html': 'text/html',
      'css': 'text/css',
      'py': 'text/x-python',
      'java': 'text/x-java',
      'cpp': 'text/x-c++src',
      'c': 'text/x-csrc',
      'md': 'text/markdown',
      'txt': 'text/plain',
      'php': 'text/x-php',
      'rb': 'text/x-ruby',
      'go': 'text/x-go',
      'rs': 'text/x-rust',
      'swift': 'text/x-swift',
      'kt': 'text/x-kotlin',
      'sh': 'text/x-shellscript',
      'xml': 'application/xml',
      'yml': 'application/x-yaml',
      'yaml': 'application/x-yaml',
    };
    
    return contentTypes[extension || ''] || 'text/plain';
  }

  isHealthy(): boolean {
    console.log(`🔍 [Cloud] Health check: ${this.isConnected}`);
    return this.isConnected;
  }

  async healthCheck(): Promise<boolean> {
    console.log(`🔍 [Cloud] Performing health check...`);
    try {
      if (!this.isConnected) {
        console.log(`🔍 [Cloud] Not connected, returning false`);
        return false;
      }
      
      await this.client.listBuckets();
      console.log(`✅ [Cloud] Health check passed`);
      return true;
    } catch (error) {
      console.error('❌ [Cloud] Health check failed:', error);
      this.isConnected = false;
      return false;
    }
  }
}
