/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { parse as parseXml, j2xParser } from 'fast-xml-parser';
import {
  MetadataApiDeploy,
  MetadataApiDeployOptions,
  MetadataApiRetrieve,
  MetadataApiRetrieveOptions,
} from '../client';
import { MetadataComponent, MetadataType, XML_DECL, XML_NS_KEY, XML_NS_URL } from '../common';
import { ComponentSetError } from '../errors';
import {
  MetadataResolver,
  NodeFSTreeContainer,
  RegistryAccess,
  SourceComponent,
} from '../metadata-registry';
import {
  PackageTypeMembers,
  FromSourceOptions,
  FromManifestOptions,
  PackageManifestObject,
  ResolveOptions,
} from './types';
import { ComponentLike } from '../common/types';

export type DeploySetOptions = Omit<MetadataApiDeployOptions, 'components'>;
export type RetrieveSetOptions = Omit<MetadataApiRetrieveOptions, 'components'>;

export class ComponentSet implements Iterable<MetadataComponent> {
  private static readonly WILDCARD = '*';
  private static readonly KEY_DELIMITER = '#';
  public apiVersion: string;
  private registry: RegistryAccess;
  private components = new Map<string, Map<string, SourceComponent>>();

  public constructor(components: Iterable<ComponentLike> = [], registry = new RegistryAccess()) {
    this.registry = registry;
    this.apiVersion = this.registry.apiVersion;
    for (const component of components) {
      this.add(component);
    }
  }

  /**
   * Create a set by resolving components from source.
   *
   * @param fsPath Path to resolve components from
   * @param options
   */
  public static fromSource(fsPath: string, options: FromSourceOptions = {}): ComponentSet {
    const ws = new ComponentSet(undefined, options.registry);
    ws.resolveSourceComponents(fsPath, options);
    return ws;
  }

  /**
   * Create a set by reading a manifest file in xml format. Optionally, specify a file path
   * with the `resolve` option to resolve source files for the components.
   *
   * ```
   * WorkingSet.fromManifestFile('/path/to/package.xml', {
   *  resolve: '/path/to/force-app'
   * });
   * ```
   *
   * @param fsPath Path to xml file
   * @param options
   */
  public static async fromManifestFile(
    fsPath: string,
    options: FromManifestOptions = {}
  ): Promise<ComponentSet> {
    const registry = options.registry ?? new RegistryAccess();
    const tree = options.tree ?? new NodeFSTreeContainer();
    const shouldResolve = !!options.resolve;

    const ws = new ComponentSet(undefined, registry);
    const filterSet = new ComponentSet(undefined, registry);
    const file = await tree.readFile(fsPath);
    const manifestObj: PackageManifestObject = parseXml(file.toString(), {
      stopNodes: ['version'],
    });

    ws.apiVersion = manifestObj.Package.version;

    for (const component of ComponentSet.getComponentsFromManifestObject(manifestObj, registry)) {
      if (shouldResolve) {
        filterSet.add(component);
      }
      const memberIsWildcard = component.fullName === ComponentSet.WILDCARD;
      if (!memberIsWildcard || options?.literalWildcard || !shouldResolve) {
        ws.add(component);
      }
    }

    if (shouldResolve) {
      // if it's a string, don't iterate over the characters
      const toResolve = typeof options.resolve === 'string' ? [options.resolve] : options.resolve;
      for (const fsPath of toResolve) {
        ws.resolveSourceComponents(fsPath, {
          tree,
          filter: filterSet,
        });
      }
    }

    return ws;
  }

  private static *getComponentsFromManifestObject(
    obj: PackageManifestObject,
    registry: RegistryAccess
  ): IterableIterator<MetadataComponent> {
    const { types } = obj.Package;
    const typeMembers = Array.isArray(types) ? types : [types];
    for (const { name: typeName, members } of typeMembers) {
      const fullNames = Array.isArray(members) ? members : [members];
      for (const fullName of fullNames) {
        let type = registry.getTypeByName(typeName);
        // if there is no / delimiter and it's a type in folders, infer folder component
        if (type.folderType && !fullName.includes('/')) {
          type = registry.getTypeByName(type.folderType);
        }
        yield {
          fullName,
          type,
        };
      }
    }
  }

  /**
   * Constructs a deploy operation using the components in the set. There must be at least
   * one source-backed component in the set to create an operation.
   *
   * @param options
   */
  public deploy(options: DeploySetOptions): MetadataApiDeploy {
    const toDeploy = Array.from(this.getSourceComponents());

    if (toDeploy.length === 0) {
      throw new ComponentSetError('error_no_source_to_deploy');
    }

    const operationOptions = Object.assign({}, options, {
      components: this,
      registry: this.registry,
    });

    return new MetadataApiDeploy(operationOptions);
  }

  /**
   * Constructs a retrieve operation using the components in the set.
   *
   * @param options
   */
  public retrieve(options: RetrieveSetOptions): MetadataApiRetrieve {
    if (this.size === 0) {
      throw new ComponentSetError('error_no_components_to_retrieve');
    }

    const operationOptions = Object.assign({}, options, {
      components: this,
      registry: this.registry,
    });

    return new MetadataApiRetrieve(operationOptions);
  }

  /**
   * Get an object representation of a package manifest based on the set components.
   */
  public getObject(): PackageManifestObject {
    const typeMap = new Map<string, string[]>();
    for (const key of this.components.keys()) {
      const [typeId, fullName] = key.split(ComponentSet.KEY_DELIMITER);
      let type = this.registry.getTypeByName(typeId);

      if (type.folderContentType) {
        type = this.registry.getTypeByName(type.folderContentType);
      }

      if (!typeMap.has(type.name)) {
        typeMap.set(type.name, []);
      }

      typeMap.get(type.name).push(fullName);
    }

    const typeMembers: PackageTypeMembers[] = [];
    for (const [typeName, members] of typeMap.entries()) {
      typeMembers.push({ members, name: typeName });
    }

    return {
      Package: {
        types: typeMembers,
        version: this.apiVersion,
      },
    };
  }

  /**
   * Resolve source backed components and add them to the set.
   *
   * @param fsPath: File path to resolve
   * @param options
   */
  public resolveSourceComponents(fsPath: string, options: ResolveOptions = {}): ComponentSet {
    let filterSet: ComponentSet;

    if (options?.filter) {
      const { filter } = options;
      filterSet = filter instanceof ComponentSet ? filter : new ComponentSet(filter);
    }

    // TODO: move most of this logic to resolver W-8023153
    const resolver = new MetadataResolver(this.registry, options?.tree);
    const resolved = resolver.getComponentsFromPath(fsPath);
    const sourceComponents = new ComponentSet();

    for (const component of resolved) {
      if (filterSet) {
        const includedInWildcard = filterSet.has({
          fullName: ComponentSet.WILDCARD,
          type: component.type,
        });
        const parentInFilter =
          component.parent &&
          (filterSet.has(component.parent) ||
            filterSet.has({
              fullName: ComponentSet.WILDCARD,
              type: component.parent.type,
            }));
        if (filterSet.has(component) || includedInWildcard || parentInFilter) {
          this.add(component);
          sourceComponents.add(component);
        } else {
          // have to check for any individually addressed children in the filter set
          for (const childComponent of component.getChildren()) {
            if (filterSet.has(childComponent)) {
              this.add(childComponent);
              sourceComponents.add(childComponent);
            }
          }
        }
      } else {
        this.add(component);
        sourceComponents.add(component);
      }
    }

    return sourceComponents;
  }

  /**
   * Create a manifest in xml format (package.xml) based on the set components.
   *
   * @param indentation Number of spaces to indent lines by.
   */
  public getPackageXml(indentation = 4): string {
    const j2x = new j2xParser({
      format: true,
      indentBy: new Array(indentation + 1).join(' '),
      ignoreAttributes: false,
    });
    const toParse = this.getObject() as any;
    toParse.Package[XML_NS_KEY] = XML_NS_URL;
    return XML_DECL.concat(j2x.parse(toParse));
  }

  public *getSourceComponents(forMember?: ComponentLike): IterableIterator<SourceComponent> {
    let iter;

    if (forMember) {
      const parentType = this.registry.getParentType(forMember.type);
      if (parentType) {
        yield* this.findChildrenThroughParent(parentType, forMember.fullName);
      }
      // filter optimization since members are keyed
      const memberCollection = this.components.get(this.simpleKey(forMember));
      iter = memberCollection?.size > 0 ? memberCollection.values() : [];
    } else {
      iter = this;
    }

    for (const component of iter) {
      if (component instanceof SourceComponent) {
        yield component;
      }
    }
  }

  public add(component: ComponentLike): void {
    const key = this.simpleKey(component);
    if (!this.components.has(key)) {
      this.components.set(key, new Map<string, SourceComponent>());
    }
    if (component instanceof SourceComponent) {
      this.components.get(key).set(this.sourceKey(component), component);
    }
  }

  public has(component: ComponentLike): boolean {
    return this.components.has(this.simpleKey(component));
  }

  public *[Symbol.iterator](): Iterator<MetadataComponent> {
    for (const [key, sourceComponents] of this.components.entries()) {
      if (sourceComponents.size === 0) {
        const [typeName, fullName] = key.split(ComponentSet.KEY_DELIMITER);
        yield {
          fullName,
          type: this.registry.getTypeByName(typeName),
        };
      } else {
        for (const component of sourceComponents.values()) {
          yield component;
        }
      }
    }
  }

  get size(): number {
    let size = 0;
    for (const collection of this.components.values()) {
      // just having an entry in the parent map counts as 1
      size += collection.size === 0 ? 1 : collection.size;
    }
    return size;
  }

  /**
   * Searches for a source-backed child components in the set through its parent.
   *
   * @param parentType
   * @param childFullName
   */
  private *findChildrenThroughParent(
    parentType: MetadataType,
    childFullName: string
  ): IterableIterator<SourceComponent> {
    const parentKey = this.simpleKey({ fullName: childFullName.split('.')[0], type: parentType });
    const parentCollection = this.components.get(parentKey);
    if (parentCollection) {
      for (const parentComponent of this.components.get(parentKey).values()) {
        const childComponent = parentComponent
          .getChildren()
          .find((child) => child.fullName === childFullName);
        if (childComponent) {
          yield childComponent;
        }
      }
    }
  }

  private sourceKey(component: SourceComponent): string {
    const { fullName, type, xml, content } = component;
    return `${type.name}${fullName}${xml ?? ''}${content ?? ''}`;
  }

  private simpleKey(component: ComponentLike): string {
    const typeName =
      typeof component.type === 'string' ? component.type.toLowerCase().trim() : component.type.id;
    return `${typeName}${ComponentSet.KEY_DELIMITER}${component.fullName}`;
  }
}
