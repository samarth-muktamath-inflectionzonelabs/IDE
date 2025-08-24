import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './User.entity.js';
import { ProjectFile } from './ProjectFile.entity.js';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', name: 'minio_path' })
  minioPath: string;

  @Column({ type: 'varchar', default: 'active' })
  status: string;

  @ManyToOne(() => User, user => user.projects)
  user: User;

  @OneToMany(() => ProjectFile, file => file.project)
  files: ProjectFile[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
    