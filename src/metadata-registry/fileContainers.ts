import { SourcePath, MetadataType } from '../types';
import { lstatSync, readdirSync, existsSync } from 'fs';
import { join, dirname, sep, basename } from 'path';
import { parseMetadataXml } from '../utils/registry';
import { baseName } from '../utils';
// @ts-ignore
import * as fetch from 'node-fetch';

export interface FileContainer {
  isDirectory(path: SourcePath): boolean;
  exists(path: SourcePath): boolean;
  findContent(dir: SourcePath, fullName: string): SourcePath | undefined;
  findMetadataXml(dir: SourcePath, fullName: string): SourcePath | undefined;
  findXmlFromContentPath(contentPath: SourcePath, type: MetadataType): SourcePath | undefined;
  readDir(path: SourcePath): string[];
  walk(dir: SourcePath, ignore?: Set<SourcePath>): SourcePath[];
}

abstract class BaseFileContainer implements FileContainer {
  public walk(dir: SourcePath, ignore?: Set<SourcePath>): SourcePath[] {
    const paths: SourcePath[] = [];
    for (const file of this.readDir(dir)) {
      const p = join(dir, file);
      if (this.isDirectory(p)) {
        paths.push(...this.walk(p, ignore));
      } else if (!ignore || !ignore.has(p)) {
        paths.push(p);
      }
    }
    return paths;
  }

  public findContent(dir: SourcePath, fullName: string): SourcePath | undefined {
    return this.find(dir, fullName, false);
  }

  public findMetadataXml(dir: SourcePath, fullName: string): SourcePath | undefined {
    return this.find(dir, fullName, true);
  }

  public findXmlFromContentPath(contentPath: SourcePath, type: MetadataType): SourcePath {
    const pathParts = contentPath.split(sep);
    const typeFolderIndex = pathParts.findIndex(part => part === type.directoryName);
    const offset = type.inFolder ? 3 : 2;
    const rootContentPath = pathParts.slice(0, typeFolderIndex + offset).join(sep);
    const rootTypeDirectory = dirname(rootContentPath);
    const contentFullName = baseName(rootContentPath);
    return this.findMetadataXml(rootTypeDirectory, contentFullName);
  }

  public abstract isDirectory(path: SourcePath): boolean;
  public abstract exists(path: SourcePath): boolean;
  public abstract readDir(path: SourcePath): string[];

  private find(
    dir: SourcePath,
    fullName: string,
    findMetadataXml: boolean
  ): SourcePath | undefined {
    const fileName = this.readDir(dir).find(f => {
      const parsed = parseMetadataXml(join(dir, f));
      const metaXmlCondition = findMetadataXml ? !!parsed : !parsed;
      return f.startsWith(fullName) && metaXmlCondition;
    });
    if (fileName) {
      return join(dir, fileName);
    }
  }
}

export class LocalFileContainer extends BaseFileContainer {
  public isDirectory(path: SourcePath): boolean {
    return lstatSync(path).isDirectory();
  }

  public exists(path: SourcePath): boolean {
    return existsSync(path);
  }

  public readDir(path: SourcePath): string[] {
    return readdirSync(path);
  }
}

export class GithubFileContainer extends BaseFileContainer {
  private repoOwner: string;
  private repoName: string;
  private treeRef: string;
  private tree = new Map<SourcePath, Set<SourcePath>>();

  constructor(repoOwner: string, repoName: string, treeRef: string) {
    super();
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.treeRef = treeRef;
  }

  public async fetch() {
    const response = await fetch(
      `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/git/trees/${
        this.treeRef
      }?recursive=true`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}` }
      }
    );
    const result = await response.json();
    for (const entry of result.tree) {
      const parent = dirname(entry.path);
      if (!this.tree.has(parent)) {
        this.tree.set(parent, new Set<SourcePath>());
      }
      this.tree.get(parent).add(entry.path);
      if (entry.type === 'tree' && !this.tree.has(entry.path)) {
        this.tree.set(entry.path, new Set<SourcePath>());
      }
    }
  }

  public isDirectory(path: string): boolean {
    if (this.exists(path)) {
      return this.tree.has(path);
    }
    throw new Error(path + ' does not exist');
  }

  public exists(path: string): boolean {
    return this.tree.get(dirname(path)).has(path) || this.tree.has(path);
  }

  public readDir(path: string): string[] {
    return Array.from(this.tree.get(path)).map(p => basename(p));
  }
}
