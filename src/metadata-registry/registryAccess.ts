/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { existsSync, readdirSync } from 'fs';
import { sep, join, basename, dirname } from 'path';
import { MetadataComponent, MetadataRegistry, MetadataType, SourcePath } from '../types';
import { getAdapter, AdapterId } from './adapters';
import { parseMetadataXml, deepFreeze } from '../utils/registry';
import { TypeInferenceError } from '../errors';
import { registryData } from '.';
import { MixedContent } from './adapters/mixedContent';
import { parentName, extName } from '../utils/path';
import { isDirectory } from '../utils/fileSystemHandler';
import { ForceIgnore } from './forceIgnore';
import { FileContainer, LocalFileContainer } from './fileContainers';

/**
 * Infer information about metadata types and components based on source paths.
 */
export class RegistryAccess {
  public readonly data: MetadataRegistry;
  private forceIgnore: ForceIgnore;
  private fileContainer: FileContainer;

  /**
   * @param data Optional custom registry data.
   */
  constructor(data?: MetadataRegistry, container = new LocalFileContainer()) {
    this.fileContainer = container;
    this.data = data
      ? // deep freeze a copy, not the original object
        deepFreeze(JSON.parse(JSON.stringify(data)) as MetadataRegistry)
      : // registryData is already frozen
        registryData;
  }

  /**
   * Get metadata type information.
   *
   * @param name Name of the metadata type
   */
  public getTypeFromName(name: string): MetadataType {
    const lower = name.toLowerCase().replace(/ /g, '');
    if (!this.data.types[lower]) {
      throw new TypeInferenceError('error_missing_type_definition', lower);
    }
    return this.data.types[lower];
  }

  /**
   * Get the metadata component(s) from a file path.
   *
   * @param fsPath File path for a piece of metadata
   */
  public getComponentsFromPath(fsPath: string): MetadataComponent[] {
    if (!this.fileContainer.exists(fsPath)) {
      throw new TypeInferenceError('error_path_not_found', fsPath);
    }

    let pathForFetch = fsPath;
    this.forceIgnore = ForceIgnore.findAndCreate(fsPath);

    if (this.fileContainer.isDirectory(fsPath)) {
      // If we can determine a type from a directory path, and the end part of the path isn't
      // the directoryName of the type itself, we know the path is part of a mixedContent component
      const typeId = this.determineTypeId(fsPath);
      if (typeId) {
        const type = this.getTypeFromName(typeId);
        const { directoryName, inFolder } = type;
        const parts = fsPath.split(sep);
        const folderOffset = inFolder ? 2 : 1;
        if (parts[parts.length - folderOffset] !== directoryName) {
          pathForFetch = this.fileContainer.findXmlFromContentPath(fsPath, type) || fsPath;
        }
      }
      if (pathForFetch === fsPath) {
        return this.getComponentsFromPathRecursive(fsPath);
      }
    }

    const component = this.fetchComponent(pathForFetch);
    return component ? [component] : [];
  }

  private determineTypeId(fsPath: SourcePath): string | undefined {
    let typeId: string;

    // attempt 1 - check if the file is part of a mixed content type
    const pathParts = new Set(fsPath.split(sep));
    for (const directoryName of Object.keys(this.data.mixedContent)) {
      if (pathParts.has(directoryName)) {
        typeId = this.data.mixedContent[directoryName];
        // types with folders only have folder components living at the top level.
        // if the fsPath is a folder component, let a future strategy deal with it
        const isFolderType = this.getTypeFromName(typeId).inFolder;
        if (isFolderType && parentName(fsPath) === directoryName) {
          typeId = undefined;
        }
        break;
      }
    }
    // attempt 2 - check if it's a metadata xml file
    if (!typeId) {
      const parsedMetaXml = parseMetadataXml(fsPath);
      if (parsedMetaXml) {
        typeId = this.data.suffixes[parsedMetaXml.suffix];
      }
    }
    // attempt 3 - try treating the file extension name as a suffix
    if (!typeId) {
      typeId = this.data.suffixes[extName(fsPath)];
    }

    return typeId;
  }

  private fetchComponent(fsPath: SourcePath): MetadataComponent {
    if (parseMetadataXml(fsPath) && this.forceIgnore.denies(fsPath)) {
      // don't bother fetching the component if the meta xml is denied
      return;
    }
    const typeId = this.determineTypeId(fsPath);
    if (typeId) {
      const adapterId = this.data.adapters[typeId] as AdapterId;
      const adapter = getAdapter(
        this.getTypeFromName(typeId),
        adapterId,
        this.fileContainer,
        this.forceIgnore
      );
      return adapter.getComponent(fsPath);
    }
    throw new TypeInferenceError('error_could_not_infer_type', fsPath);
  }

  private getComponentsFromPathRecursive(directory: SourcePath): MetadataComponent[] {
    const dirQueue: SourcePath[] = [];
    const components: MetadataComponent[] = [];

    if (this.forceIgnore.denies(directory)) {
      return components;
    }

    for (const file of this.fileContainer.readDir(directory)) {
      const path = join(directory, file);
      if (this.fileContainer.isDirectory(path)) {
        dirQueue.push(path);
      } else if (parseMetadataXml(path)) {
        const component = this.fetchComponent(path);
        if (component) {
          components.push(component);
          // don't traverse further if not in a root type directory. performance optimization
          // for mixed content types and ensures we don't add duplicates of the component.
          const isMixedContent = !!this.data.mixedContent[component.type.directoryName];
          const typeDir = basename(dirname(component.type.inFolder ? dirname(path) : path));
          if (isMixedContent && typeDir !== component.type.directoryName) {
            return components;
          }
        }
      }
    }

    for (const dir of dirQueue) {
      components.push(...this.getComponentsFromPathRecursive(dir));
    }

    return components;
  }

  public getApiVersion(): string {
    return this.data.apiVersion;
  }
}
