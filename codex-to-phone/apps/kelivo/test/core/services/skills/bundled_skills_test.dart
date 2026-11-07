import 'dart:convert';
import 'dart:io';

import 'package:Kelivo/core/database/extension_entity_store.dart';
import 'package:Kelivo/core/models/skill_record.dart';
import 'package:Kelivo/core/services/skills/skills_service.dart';
import 'package:Kelivo/core/services/workspace/workspace_tools_service.dart';
import 'package:Kelivo/utils/mcp_structured_image.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

import '../../../support/business_test_harness.dart';

class _MissingAssets extends CachingAssetBundle {
  @override
  Future<ByteData> load(String key) async => throw StateError('asset missing');
}

class _InterceptedAssets extends CachingAssetBundle {
  _InterceptedAssets(this.beforeLoad);

  final Future<void> Function(String key) beforeLoad;

  @override
  Future<ByteData> load(String key) async {
    await beforeLoad(key);
    return rootBundle.load(key);
  }
}

// git show HEAD originals, verified against integrations/kelivo/source-files.json.
const _legacyAssetSha256 = {
  'skill-creator/SKILL.md':
      'e6dab535a636aafa4f99bc54c33134072ce120a33a060e72d24d155f49324e44',
  'visualize/SKILL.md':
      'b22b1a04cfbf070e15b14b43b17518dcd19142b083b417a900bce41b2955007e',
  'visualize/references/protocol.md':
      'f7d6093980cc09344d99b639bc71241c7722f0843371e37643c19878d6eeebdd',
};

Future<List<int>> _legacyAssetBytes(String relative) async {
  final asset = await rootBundle.loadString('assets/skills/$relative');
  final bytes = utf8.encode(asset.replaceAll('MobiCodex', 'Kelivo'));
  // Reconstruct only the natural-language rename, then require exact old bytes.
  expect(sha256.convert(bytes).toString(), _legacyAssetSha256[relative]);
  return bytes;
}

class _FailingSkillStore extends ExtensionEntityStore {
  _FailingSkillStore(super.database);

  @override
  Future<void> upsert(
    String kind,
    String id,
    Map<String, dynamic> payload, {
    int? sortOrder,
    String? ownerId,
  }) async => throw StateError('store unavailable');
}

Skill _creator(SkillsService service) =>
    service.skills.singleWhere((s) => s.record.id == 'skill-creator');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late BusinessTestHarness harness;
  late Directory root;
  late ExtensionEntityStore store;

  setUp(() async {
    harness = await createBusinessTestHarness();
    store = ExtensionEntityStore(harness.database);
    root = await Directory.systemTemp.createTemp('kelivo_bundled_skills_');
    addTearDown(() => root.delete(recursive: true));
  });

  SkillsService createService({
    AssetBundle? assets,
    ExtensionEntityStore? entityStore,
  }) {
    final service = SkillsService(
      store: entityStore ?? store,
      skillsDirectory: root,
      bundledAssets: assets ?? rootBundle,
    );
    addTearDown(service.dispose);
    return service;
  }

  Future<void> restoreLegacyAssets() async {
    for (final relative in _legacyAssetSha256.keys) {
      await File(
        p.join(root.path, relative),
      ).writeAsBytes(await _legacyAssetBytes(relative));
    }
  }

  test(
    'bundled creator is enabled, discoverable and readable without a workspace',
    () async {
      final service = createService();
      await service.loaded;
      final skill = _creator(service);
      expect(skill.record.id, 'skill-creator');
      expect(skill.record.source, SkillSource.bundled);
      expect(skill.record.enabled, isTrue);
      final markdown = await File(skill.skillMdPath).readAsString();
      final parsed = SkillFrontmatter.parse(markdown);
      expect(parsed.validate(), isEmpty);
      expect(parsed.name, skill.record.id);
      expect(parsed.description.length, lessThanOrEqualTo(200));
      expect(parsed.body.trim(), isNotEmpty);
      expect(markdown, contains('works in MobiCodex'));
      expect(markdown, isNot(contains('Kelivo')));
      expect(markdown, contains('kelivo://skills/'));
      expect(
        buildAvailableSkillsFragment(
          service.resolveForAssistant(null),
          skillsModelRoot: '/skills',
        ),
        contains('/skills/skill-creator/SKILL.md'),
      );
      final result = ClientToolResult.fromHandler(
        await WorkspaceToolsService().handle(
          WorkspaceToolContext.skillsOnly(skillsHostDir: root.path),
          'read_file',
          {'path': '/skills/skill-creator/SKILL.md'},
          toolCallId: 'read-creator',
        ),
      );
      expect(result.content, contains('# Skill Creator'));
    },
  );

  test(
    'refreshes exact legacy bundled files without changing user choices',
    () async {
      final installed = createService();
      await installed.loaded;
      final records = <String, Map<String, dynamic>>{};
      for (final skill in installed.skills) {
        await installed.setEnabled(skill.record.id, false);
        await installed.incrementUseCount(skill.record.id);
        records[skill.record.id] = (await store.get(
          ExtensionEntityStore.kindSkill,
          skill.record.id,
        ))!.payload;
        await File(
          p.join(root.path, '.bundled-${skill.record.id}'),
        ).writeAsString('1 \r\n');
      }
      await restoreLegacyAssets();

      final upgraded = createService();
      await upgraded.loaded;
      for (final relative in _legacyAssetSha256.keys) {
        expect(
          await File(p.join(root.path, relative)).readAsString(),
          await rootBundle.loadString('assets/skills/$relative'),
        );
      }
      for (final skill in upgraded.skills) {
        expect(skill.record.toJson(), records[skill.record.id]);
        expect(
          await File(
            p.join(root.path, '.bundled-${skill.record.id}'),
          ).readAsString(),
          '1 \r\n',
        );
      }
      // New bytes need no asset read or another write on subsequent startups.
      final restarted = createService(assets: _MissingAssets());
      await restarted.loaded;
      expect(restarted.skills, hasLength(2));
    },
  );

  test('refresh keeps byte-level edits and missing references', () async {
    await createService().loaded;
    await restoreLegacyAssets();
    final creator = File(p.join(root.path, 'skill-creator/SKILL.md'));
    final editedCreator = '${await creator.readAsString()}\n';
    await creator.writeAsString(editedCreator);
    final protocol = File(
      p.join(root.path, 'visualize/references/protocol.md'),
    );
    final editedProtocol = (await protocol.readAsString()).replaceAll(
      '\n',
      '\r\n',
    );
    await protocol.writeAsString(editedProtocol);
    final deleted = File(p.join(root.path, 'visualize/references/content.md'));
    await deleted.delete();
    final notes = File(p.join(root.path, 'visualize/notes.txt'));
    await notes.writeAsString('User notes');

    await createService().loaded;
    expect(await creator.readAsString(), editedCreator);
    expect(await protocol.readAsString(), editedProtocol);
    expect(await deleted.exists(), isFalse);
    expect(await notes.readAsString(), 'User notes');
    expect(
      await File(p.join(root.path, 'visualize/SKILL.md')).readAsString(),
      await rootBundle.loadString('assets/skills/visualize/SKILL.md'),
    );
  });

  for (final source in [
    SkillSource.paste,
    SkillSource.file,
    SkillSource.github,
  ]) {
    test(
      'does not refresh exact legacy bytes owned by ${source.name}',
      () async {
        final installed = createService();
        await installed.loaded;
        await restoreLegacyAssets();
        for (final skill in installed.skills) {
          await store.upsert(
            ExtensionEntityStore.kindSkill,
            skill.record.id,
            skill.record.copyWith(source: source).toJson(),
          );
        }
        await createService(assets: _MissingAssets()).loaded;
        for (final relative in _legacyAssetSha256.keys) {
          expect(
            await File(p.join(root.path, relative)).readAsBytes(),
            await _legacyAssetBytes(relative),
          );
        }
      },
    );
  }

  test(
    'exact legacy bytes without bundled metadata remain user-owned',
    () async {
      await createService().loaded;
      await restoreLegacyAssets();
      await store.delete(ExtensionEntityStore.kindSkill, 'visualize');

      final restarted = createService();
      await restarted.loaded;
      final visualize = restarted.skills.singleWhere(
        (s) => s.record.id == 'visualize',
      );
      expect(visualize.record.source, SkillSource.file);
      for (final relative in _legacyAssetSha256.keys.where(
        (path) => path.startsWith('visualize/'),
      )) {
        expect(
          await File(p.join(root.path, relative)).readAsBytes(),
          await _legacyAssetBytes(relative),
        );
      }
    },
  );

  test(
    'refresh also covers a bundled installation without a receipt',
    () async {
      await createService().loaded;
      await restoreLegacyAssets();
      await File(p.join(root.path, '.bundled-visualize')).delete();

      await createService().loaded;
      expect(
        await File(p.join(root.path, 'visualize/SKILL.md')).readAsString(),
        await rootBundle.loadString('assets/skills/visualize/SKILL.md'),
      );
      expect(
        await File(p.join(root.path, '.bundled-visualize')).readAsString(),
        '1\n',
      );
    },
  );

  test(
    'does not refresh leftover references after entrypoint deletion',
    () async {
      await createService().loaded;
      await restoreLegacyAssets();
      await File(p.join(root.path, 'visualize/SKILL.md')).delete();
      final restarted = createService();
      await restarted.loaded;
      expect(restarted.skills.map((s) => s.record.id), ['skill-creator']);
      expect(
        await File(p.join(root.path, 'visualize/SKILL.md')).exists(),
        isFalse,
      );
      expect(
        await File(
          p.join(root.path, 'visualize/references/protocol.md'),
        ).readAsBytes(),
        await _legacyAssetBytes('visualize/references/protocol.md'),
      );
      expect(
        await File(p.join(root.path, '.bundled-visualize')).readAsString(),
        '1\n',
      );
    },
  );

  for (final remove in [false, true]) {
    test(
      'rechecks a concurrent ${remove ? 'deletion' : 'edit'} before publishing',
      () async {
        await createService().loaded;
        await restoreLegacyAssets();
        final target = File(p.join(root.path, 'skill-creator/SKILL.md'));
        final edited = '${await target.readAsString()}\nUser edit\n';
        final assets = _InterceptedAssets((key) async {
          if (key != 'assets/skills/skill-creator/SKILL.md') return;
          if (remove) {
            await target.delete();
          } else {
            await target.writeAsString(edited);
          }
        });
        await createService(assets: assets).loaded;
        if (remove) {
          expect(await target.exists(), isFalse);
        } else {
          expect(await target.readAsString(), edited);
        }
        expect(
          await root
              .list()
              .where((e) => p.basename(e.path).startsWith('.bundled-branding-'))
              .toList(),
          isEmpty,
        );
      },
    );
  }

  test(
    'refresh asset failure preserves the old file and receipt for retry',
    () async {
      await createService().loaded;
      await restoreLegacyAssets();
      await expectLater(
        createService(assets: _MissingAssets()).loaded,
        throwsStateError,
      );
      expect(
        await File(p.join(root.path, 'skill-creator/SKILL.md')).readAsBytes(),
        await _legacyAssetBytes('skill-creator/SKILL.md'),
      );
      expect(
        await File(p.join(root.path, '.bundled-skill-creator')).readAsString(),
        '1\n',
      );
      await createService().loaded;
      expect(
        await File(p.join(root.path, 'skill-creator/SKILL.md')).readAsString(),
        await rootBundle.loadString('assets/skills/skill-creator/SKILL.md'),
      );
    },
  );

  for (final linkParent in [false, true]) {
    test(
      'refresh never follows a ${linkParent ? 'parent' : 'file'} symlink',
      () async {
        await createService().loaded;
        await restoreLegacyAssets();
        final outside = await Directory.systemTemp.createTemp(
          'bundled-branding-canary-',
        );
        addTearDown(() => outside.delete(recursive: true));
        final canary = File(p.join(outside.path, 'protocol.md'));
        final old = await _legacyAssetBytes('visualize/references/protocol.md');
        await canary.writeAsBytes(old);
        final reference = File(
          p.join(root.path, 'visualize/references/protocol.md'),
        );
        if (linkParent) {
          await reference.parent.delete(recursive: true);
          await Link(reference.parent.path).create(outside.path);
        } else {
          await reference.delete();
          await Link(reference.path).create(canary.path);
        }
        await createService().loaded;
        expect(await canary.readAsBytes(), old);
      },
      skip: Platform.isWindows
          ? 'Symlink creation needs host-specific privileges'
          : false,
    );
  }

  test(
    'restart preserves edits, disabled state and usage without duplicating',
    () async {
      final service = createService();
      await service.loaded;
      const updated =
          '---\nname: skill-creator\ndescription: My workflow\n---\n'
          '# My edited creator\n';
      await service.updateBody('skill-creator', updated);
      await service.setEnabled('skill-creator', false);
      await service.incrementUseCount('skill-creator');

      final restarted = createService();
      await restarted.loaded;
      await restarted.rescan();
      final skill = _creator(restarted);
      expect(await File(skill.skillMdPath).readAsString(), updated);
      expect(skill.record.source, SkillSource.bundled);
      expect(skill.record.enabled, isFalse);
      expect(skill.record.useCount, 1);
      expect(restarted.resolveForAssistant(null).map((s) => s.record.id), [
        'visualize',
      ]);
    },
  );

  test(
    'deleted bundled skill stays deleted after rescanning and restarting',
    () async {
      final service = createService();
      await service.loaded;
      await service.delete('skill-creator');
      await service.rescan();
      expect(service.skills.map((s) => s.record.id), ['visualize']);

      final restarted = createService();
      await restarted.loaded;
      expect(restarted.skills.map((s) => s.record.id), ['visualize']);
      expect(
        (await store.listByKind(
          ExtensionEntityStore.kindSkill,
        )).map((s) => s.id),
        ['visualize'],
      );
    },
  );

  for (final keepDirectory in [false, true]) {
    test(
      'restores missing bundled markdown from metadata (directory: $keepDirectory)',
      () async {
        final installedAt = DateTime.utc(2026, 1, 1);
        await store.upsert(
          ExtensionEntityStore.kindSkill,
          'skill-creator',
          SkillRecord(
            id: 'skill-creator',
            source: SkillSource.bundled,
            enabled: false,
            useCount: 7,
            installedAt: installedAt,
            updatedAt: installedAt,
          ).toJson(),
        );
        final reference = File(p.join(root.path, 'skill-creator', 'notes.txt'));
        if (keepDirectory) {
          await reference.parent.create();
          await reference.writeAsString('User notes');
        }

        final service = createService();
        await service.loaded;
        final skill = _creator(service);
        expect(await File(skill.skillMdPath).exists(), isTrue);
        expect(skill.record.source, SkillSource.bundled);
        expect(skill.record.enabled, isFalse);
        expect(skill.record.useCount, 7);
        expect(skill.record.installedAt, installedAt);
        if (keepDirectory) {
          expect(await reference.readAsString(), 'User notes');
        }

        final restarted = createService();
        await restarted.loaded;
        expect(_creator(restarted).record.toJson(), skill.record.toJson());
      },
    );
  }

  test(
    'upgrade keeps existing skills and does not overwrite a same-name import',
    () async {
      final previous = SkillsService(store: store, skillsDirectory: root);
      addTearDown(previous.dispose);
      await previous.importFromText(
        '---\nname: skill-creator\ndescription: User creator\n---\n# Custom\n',
      );
      await previous.setEnabled('skill-creator', false);
      await previous.importFromText(
        '---\nname: my-skill\ndescription: User skill\n---\n# Mine\n',
      );
      final upgraded = createService();
      await upgraded.loaded;
      expect(upgraded.skills, hasLength(3));
      final creator = upgraded.skills.singleWhere(
        (s) => s.name == 'skill-creator',
      );
      expect(creator.description, 'User creator');
      expect(creator.record.source, SkillSource.paste);
      expect(creator.record.enabled, isFalse);
    },
  );

  test('upgrade seeds creator alongside other user skills', () async {
    final existing = Directory(p.join(root.path, 'my-skill'));
    await existing.create();
    await File(p.join(existing.path, 'SKILL.md')).writeAsString(
      '---\nname: my-skill\ndescription: User skill\n---\n# Mine\n',
    );
    final service = createService();
    await service.loaded;
    expect(service.skills.map((s) => s.record.id), [
      'my-skill',
      'skill-creator',
      'visualize',
    ]);
    expect(service.skills.first.record.source, SkillSource.file);
  });

  test('asset failure can retry on the next startup', () async {
    final failed = createService(assets: _MissingAssets());
    await expectLater(failed.loaded, throwsStateError);
    expect(await root.list().toList(), isEmpty);

    final retried = createService();
    await retried.loaded;
    expect(_creator(retried).record.source, SkillSource.bundled);
  });

  test('failed repair preserves the existing directory and metadata', () async {
    final now = DateTime.utc(2026, 1, 1);
    final record = SkillRecord(
      id: 'skill-creator',
      source: SkillSource.bundled,
      enabled: false,
      useCount: 2,
      installedAt: now,
      updatedAt: now,
    );
    await store.upsert(
      ExtensionEntityStore.kindSkill,
      record.id,
      record.toJson(),
    );
    final reference = File(p.join(root.path, record.id, 'notes.txt'));
    await reference.parent.create();
    await reference.writeAsString('User notes');

    final failed = createService(
      entityStore: _FailingSkillStore(harness.database),
    );
    await expectLater(failed.loaded, throwsStateError);
    expect(await reference.readAsString(), 'User notes');
    expect(
      await File(p.join(reference.parent.path, 'SKILL.md')).exists(),
      isFalse,
    );
    expect(
      await File(p.join(root.path, '.bundled-skill-creator')).exists(),
      isFalse,
    );
    expect(
      (await store.get(ExtensionEntityStore.kindSkill, record.id))!.payload,
      record.toJson(),
    );

    final retried = createService();
    await retried.loaded;
    expect(_creator(retried).record.enabled, isFalse);
    expect(_creator(retried).record.useCount, 2);
  });

  test(
    'failed registration leaves no partial installation or completion receipt',
    () async {
      final failed = createService(
        entityStore: _FailingSkillStore(harness.database),
      );
      await expectLater(failed.loaded, throwsStateError);
      expect(await root.list().toList(), isEmpty);

      final retried = createService();
      await retried.loaded;
      expect(_creator(retried).record.source, SkillSource.bundled);
    },
  );
}
