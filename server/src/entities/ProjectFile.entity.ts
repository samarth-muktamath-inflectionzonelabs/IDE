import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Project } from './Project.entity.js';

@Entity('project_files')
export class ProjectFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })  // ← FIXED: Explicit type
  name: string;

  @Column({ type: 'varchar' })  // ← FIXED: Explicit type
  path: string;

  @Column({ type: 'varchar', name: 'minio_key' })  // ← FIXED: Explicit type
  minioKey: string;

  @Column({ type: 'varchar', name: 'file_type' })  // ← FIXED: Explicit type
  fileType: string;

  @Column({ type: 'bigint', default: 0 })  // ← FIXED: Explicit type
  size: number;

  @ManyToOne(() => Project, project => project.files)
  project: Project;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
