/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { assert, expect } from 'chai';
import {
  MetadataResolver,
  SourceComponent,
  VirtualTreeContainer,
} from '../../src/metadata-registry';
import { nls } from '../../src/i18n';
import {
  mockRegistry,
  kathy,
  keanu,
  taraji,
  tina,
  simon,
  sean,
  gene,
  mockRegistryData,
} from '../mock/registry';
import { join, basename, dirname } from 'path';
import { TypeInferenceError } from '../../src/errors';
import { RegistryTestUtil } from './registryTestUtil';
import {
  REGINA_VIRTUAL_FS,
  REGINA_PATH,
  REGINA_COMPONENT,
  REGINA_CHILD_XML_PATH_1,
  REGINA_CHILD_COMPONENT_1,
  REGINA_XML_PATH,
  REGINA_CHILD_DIR_PATH,
  REGINA_CHILD_XML_PATH_2,
} from '../mock/registry/reginaConstants';
import {
  TARAJI_COMPONENT,
  TARAJI_CONTENT_PATH,
  TARAJI_DIR,
  TARAJI_VIRTUAL_FS,
  TARAJI_XML_PATHS,
} from '../mock/registry/tarajiConstants';
import { resolveSource } from '../../src/metadata-registry/metadataResolver';
import { createSandbox } from 'sinon';
import { SourceAdapterFactory } from '../../src/metadata-registry/adapters/sourceAdapterFactory';

const env = createSandbox();

const testUtil = new RegistryTestUtil();

describe('MetadataResolver', () => {
  const resolver = new MetadataResolver(mockRegistry);

  describe('getComponentsFromPath', () => {
    afterEach(() => testUtil.restore());

    describe('File Paths', () => {
      it('should throw file not found error if given path does not exist', () => {
        const path = keanu.KEANU_SOURCE_PATHS[0];

        assert.throws(
          () => resolveSource(path).toArray(),
          TypeInferenceError,
          nls.localize('error_path_not_found', [path])
        );
      });

      it('should determine type for metadata file with known suffix', () => {
        const path = keanu.KEANU_XML_PATHS[0];
        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: keanu.KEANUS_DIR,
              children: [keanu.KEANU_SOURCE_NAMES[0], keanu.KEANU_XML_NAMES[0]],
            },
          ]),
        }).toArray();
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.keanureeves,
            componentMappings: [
              {
                path,
                component: keanu.KEANU_COMPONENT,
              },
            ],
          },
        ]);
        expect(components).to.deep.equal([keanu.KEANU_COMPONENT]);
      });

      it('should determine type for source file with known suffix', () => {
        const path = keanu.KEANU_SOURCE_PATHS[0];
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.keanureeves,
            componentMappings: [{ path, component: keanu.KEANU_COMPONENT }],
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: keanu.KEANUS_DIR,
              children: [keanu.KEANU_SOURCE_NAMES[0], keanu.KEANU_XML_NAMES[0]],
            },
          ]),
        }).toArray();

        expect(components).to.deep.equal([keanu.KEANU_COMPONENT]);
      });

      it('should determine type for path of mixed content type', () => {
        const path = taraji.TARAJI_SOURCE_PATHS[1];

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: dirname(path),
              children: [basename(path)],
            },
          ]),
        }).toArray();

        expect(components).to.deep.equal([taraji.TARAJI_COMPONENT]);
      });

      it('should determine type for path content files', () => {
        const path = keanu.KEANU_SOURCE_PATHS[0];
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.keanureeves,
            componentMappings: [{ path, component: keanu.KEANU_CONTENT_COMPONENT }],
            allowContent: false,
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: dirname(path),
              children: [basename(path)],
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal([keanu.KEANU_CONTENT_COMPONENT]);
      });

      it('should determine type for inFolder path content files', () => {
        const path = sean.SEAN_FOLDER;
        const componentMappings = sean.SEAN_PATHS.map((p: string, i: number) => ({
          path: p,
          component: sean.SEAN_COMPONENTS[i],
        }));
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.seanconnerys,
            componentMappings,
            allowContent: false,
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: path,
              children: sean.SEAN_NAMES,
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal(sean.SEAN_COMPONENTS);
      });

      it('should determine type for folder files', () => {
        const path = gene.GENE_DIR;
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.genewilder,
            componentMappings: [
              { path: gene.GENE_FOLDER_XML_PATH, component: gene.GENE_FOLDER_COMPONENT },
            ],
            allowContent: false,
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: path,
              children: [gene.GENE_FOLDER_XML_NAME],
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal([gene.GENE_FOLDER_COMPONENT]);
      });

      it('should not mistake folder component of a mixed content type as that type', () => {
        // this test has coverage on non-mixedContent types as well by nature of the execution path
        const path = tina.TINA_FOLDER_XML;
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.tinafeyfolder,
            componentMappings: [{ path, component: tina.TINA_FOLDER_COMPONENT }],
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: tina.TINA_DIR,
              children: [basename(path)],
            },
          ]),
        });

        expect(components).to.deep.equal([tina.TINA_FOLDER_COMPONENT]);
      });

      it('should throw type id error if one could not be determined', () => {
        const path = join('path', 'to', 'whatever', 'a.b-meta.xml');

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: dirname(path),
              children: [basename(path)],
            },
          ]),
        });

        assert.throws(
          () => components.toArray(),
          TypeInferenceError,
          nls.localize('error_could_not_infer_type', [path])
        );
      });

      it('should not return a component if path to metadata xml is forceignored', () => {
        const path = keanu.KEANU_XML_PATHS[0];
        testUtil.stubForceIgnore({ seed: path, deny: [path] });
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.keanureeves,
            // should not be returned
            componentMappings: [{ path, component: keanu.KEANU_COMPONENT }],
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: dirname(path),
              children: [basename(path)],
            },
          ]),
        });

        expect(components.size).to.equal(0);
      });

      it('should not return a component if path to content metadata xml is forceignored', () => {
        const path = keanu.KEANU_XML_PATHS[0];
        testUtil.stubForceIgnore({ seed: path, deny: [path] });
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.keanureeves,
            // should not be returned
            componentMappings: [{ path, component: keanu.KEANU_COMPONENT }],
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: dirname(path),
              children: [basename(path)],
            },
          ]),
        });

        expect(components.size).to.equal(0);
      });

      it('should not return a component if path to folder metadata xml is forceignored', () => {
        const path = gene.GENE_FOLDER_XML_PATH;
        testUtil.stubForceIgnore({ seed: path, deny: [path] });
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.genewilder,
            // should not be returned
            componentMappings: [
              { path: gene.GENE_FOLDER_XML_PATH, component: gene.GENE_FOLDER_COMPONENT },
            ],
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: dirname(path),
              children: [basename(path)],
            },
          ]),
        });

        expect(components.size).to.equal(0);
      });
    });

    describe('Directory Paths', () => {
      it('should return all components in a directory', () => {
        const path = kathy.KATHY_FOLDER;
        const componentMappings = kathy.KATHY_XML_PATHS.map((p: string, i: number) => ({
          path: p,
          component: kathy.KATHY_COMPONENTS[i],
        }));
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.kathybates,
            componentMappings,
          },
        ]);

        const components = resolveSource(path, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: kathy.KATHY_FOLDER,
              children: kathy.KATHY_XML_NAMES,
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal(kathy.KATHY_COMPONENTS);
      });

      it('should walk all file and directory children', () => {
        const { KEANUS_DIR } = keanu;
        const stuffDir = join(KEANUS_DIR, 'hasStuff');
        const noStuffDir = join(KEANUS_DIR, 'noStuff');
        const kathyXml = join(KEANUS_DIR, kathy.KATHY_XML_NAMES[0]);
        const keanuXml = keanu.KEANU_XML_PATHS[0];
        const keanuSrc = keanu.KEANU_SOURCE_PATHS[0];
        const keanuXml2 = join(stuffDir, keanu.KEANU_XML_NAMES[1]);
        const keanuSrc2 = join(stuffDir, keanu.KEANU_SOURCE_NAMES[1]);
        const tree = new VirtualTreeContainer([
          {
            dirPath: KEANUS_DIR,
            children: [
              basename(keanuXml),
              basename(keanuSrc),
              kathy.KATHY_XML_NAMES[0],
              'hasStuff',
              'noStuff',
            ],
          },
          {
            dirPath: noStuffDir,
            children: [],
          },
          {
            dirPath: stuffDir,
            children: [basename(keanuSrc2), basename(keanuXml2)],
          },
        ]);
        const keanuComponent2: SourceComponent = new SourceComponent(
          {
            name: 'b',
            type: mockRegistryData.types.keanureeves,
            xml: keanuXml2,
            content: keanuSrc2,
          },
          tree
        );
        const kathyComponent2 = new SourceComponent(
          {
            name: 'a',
            type: mockRegistryData.types.kathybates,
            xml: kathyXml,
          },
          tree
        );
        // const access = new MetadataResolver(mockRegistry, tree);
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.kathybates,
            componentMappings: [
              {
                path: join(KEANUS_DIR, kathy.KATHY_XML_NAMES[0]),
                component: kathyComponent2,
              },
            ],
          },
          {
            type: mockRegistryData.types.keanureeves,
            componentMappings: [
              {
                path: keanuXml,
                component: keanu.KEANU_COMPONENT,
              },
              {
                path: keanuXml2,
                component: keanuComponent2,
              },
            ],
          },
        ]);

        const components = resolveSource(KEANUS_DIR, { registry: mockRegistry, tree });

        expect(components.toArray()).to.deep.equal([
          keanu.KEANU_COMPONENT,
          kathyComponent2,
          keanuComponent2,
        ]);
      });

      it('should handle the folder of a mixed content folder type', () => {
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.tinafey,
            componentMappings: [
              {
                path: tina.TINA_XML_PATHS[0],
                component: tina.TINA_COMPONENTS[0],
              },
              {
                path: tina.TINA_XML_PATHS[1],
                component: tina.TINA_COMPONENTS[1],
              },
            ],
          },
        ]);

        const components = resolveSource(tina.TINA_FOLDER, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: tina.TINA_FOLDER,
              children: tina.TINA_XML_NAMES.concat(tina.TINA_SOURCE_NAMES),
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal([
          tina.TINA_COMPONENTS[0],
          tina.TINA_COMPONENTS[1],
        ]);
      });

      it('should return a component for a directory that is content or a child of content', () => {
        const { TARAJI_CONTENT_PATH } = taraji;
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.tarajihenson,
            componentMappings: [
              {
                path: TARAJI_CONTENT_PATH,
                component: taraji.TARAJI_COMPONENT,
              },
            ],
          },
        ]);

        const components = resolveSource(TARAJI_CONTENT_PATH, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: TARAJI_CONTENT_PATH,
              children: [],
            },
            {
              dirPath: taraji.TARAJI_DIR,
              children: [taraji.TARAJI_XML_NAMES[0], basename(TARAJI_CONTENT_PATH)],
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal([taraji.TARAJI_COMPONENT]);
      });

      it('should not add duplicates of a component when the content has multiple -meta.xmls', () => {
        const { SIMON_COMPONENT, SIMON_BUNDLE_PATH } = simon;
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.simonpegg,
            componentMappings: [
              { path: simon.SIMON_BUNDLE_PATH, component: SIMON_COMPONENT },
              { path: simon.SIMON_XML_PATH, component: SIMON_COMPONENT },
              {
                path: simon.SIMON_SUBTYPE_PATH,
                component: SIMON_COMPONENT,
              },
            ],
          },
        ]);

        const components = resolveSource(simon.SIMON_DIR, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath: simon.SIMON_DIR,
              children: [basename(SIMON_BUNDLE_PATH)],
            },
            {
              dirPath: SIMON_BUNDLE_PATH,
              children: simon.SIMON_SOURCE_PATHS.concat(simon.SIMON_XML_PATH).map((p) =>
                basename(p)
              ),
            },
          ]),
        });

        expect(components.toArray()).to.deep.equal([SIMON_COMPONENT]);
      });

      it('should not add duplicate component if directory content and xml are at the same level', () => {
        const component = SourceComponent.createVirtualComponent(
          TARAJI_COMPONENT,
          TARAJI_VIRTUAL_FS
        );
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.tarajihenson,
            componentMappings: [
              { path: TARAJI_CONTENT_PATH, component },
              { path: TARAJI_XML_PATHS[0], component },
            ],
          },
        ]);

        const components = resolveSource(TARAJI_DIR, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer(TARAJI_VIRTUAL_FS),
        });

        expect(components.toArray()).to.deep.equal([component]);
      });

      it('should stop resolution if parent component is resolved', () => {
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.reginaking,
            componentMappings: [
              { path: REGINA_XML_PATH, component: REGINA_COMPONENT },
              { path: REGINA_CHILD_XML_PATH_1, component: REGINA_CHILD_COMPONENT_1 },
            ],
          },
        ]);

        const components = resolveSource(REGINA_PATH, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer(REGINA_VIRTUAL_FS),
        });

        expect(components.toArray()).to.deep.equal([REGINA_COMPONENT]);
      });

      it('should return expected child SourceComponent when given a subdirectory of a folderPerType component', () => {
        const tree = new VirtualTreeContainer(REGINA_VIRTUAL_FS);
        const expectedComponent = new SourceComponent(REGINA_COMPONENT, tree);
        const children = expectedComponent.getChildren();
        const expectedChild = children.find((c) => c.xml === REGINA_CHILD_XML_PATH_2);

        const components = resolveSource(REGINA_CHILD_DIR_PATH, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer(REGINA_VIRTUAL_FS),
        });

        expect(components.toArray()).to.deep.equal([expectedChild]);
      });

      /**
       * Because files of a mixed content type could have any suffix, they might collide
       * with a type that uses the "suffix index" in the registry and be assigned the incorrect type.
       *
       * Pretend that this bundle's root xml suffix is the same as KeanuReeves - still should be
       * identified as SimonPegg type
       */
      it('should handle suffix collision for mixed content types', () => {
        const tree = new VirtualTreeContainer([
          {
            dirPath: simon.SIMON_DIR,
            children: [basename(simon.SIMON_BUNDLE_PATH)],
          },
          {
            dirPath: simon.SIMON_BUNDLE_PATH,
            children: [keanu.KEANU_XML_NAMES[0], basename(simon.SIMON_SOURCE_PATHS[0])],
          },
        ]);
        const components = resolveSource(simon.SIMON_DIR, { registry: mockRegistry, tree });

        expect(components.toArray()).to.deep.equal([
          new SourceComponent(
            {
              name: 'a',
              type: mockRegistryData.types.simonpegg,
              xml: join(simon.SIMON_BUNDLE_PATH, keanu.KEANU_XML_NAMES[0]),
              content: simon.SIMON_BUNDLE_PATH,
            },
            tree
          ),
        ]);
      });

      it('should not return components if the directory is forceignored', () => {
        const dirPath = kathy.KATHY_FOLDER;
        testUtil.stubForceIgnore({ seed: dirPath, deny: [dirPath] });
        testUtil.stubAdapters([
          {
            type: mockRegistryData.types.kathybates,
            componentMappings: [
              {
                path: kathy.KATHY_XML_PATHS[0],
                component: kathy.KATHY_COMPONENTS[0],
              },
              {
                path: kathy.KATHY_XML_PATHS[1],
                component: kathy.KATHY_COMPONENTS[1],
              },
            ],
          },
        ]);

        const components = resolveSource(dirPath, {
          registry: mockRegistry,
          tree: new VirtualTreeContainer([
            {
              dirPath,
              children: [kathy.KATHY_XML_NAMES[0], kathy.KATHY_XML_NAMES[1]],
            },
          ]),
        });

        expect(components.size).to.equal(0);
      });
    });
  });
});
