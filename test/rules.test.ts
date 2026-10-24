/**
 * One test per rule that fires it, plus a single test that the clean baseline
 * fires nothing at all. The second half matters as much as the first: a rule
 * that cannot be silenced by a reasonable config is noise, not a diagnosis.
 */

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { DEPRECATED_OPTIONS, KNOWN_OPTIONS, RULES, STRICT_FAMILY } from '../src/rules.js';
import { clean, cleanCodes, findByCode, fromFiles, fromOptions } from './helpers.js';

function findings(overrides: Record<string, unknown>, topLevel?: Record<string, unknown>) {
  return analyze(fromOptions(clean(overrides), topLevel ?? { include: ['src'] }));
}

describe('the clean baseline', () => {
  it('reports nothing at all', () => {
    expect(cleanCodes()).toEqual([]);
  });

  it('every rule code is unique', () => {
    const codes = RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every rule option, where given, is a real compiler option', () => {
    for (const rule of RULES) {
      if (rule.option === undefined) continue;
      expect(KNOWN_OPTIONS.has(rule.option), rule.code).toBe(true);
    }
  });
});

describe('TSD001 strict', () => {
  it('fires when strict is absent', () => {
    expect(cleanCodes({ strict: undefined })).toContain('TSD001');
  });

  it('counts the flags that are off', () => {
    const finding = findByCode(findings({ strict: undefined }), 'TSD001');
    expect(finding?.title).toContain(`${STRICT_FAMILY.length} type-safety checks`);
  });

  it('does not fire when only one family flag is disabled', () => {
    expect(cleanCodes({ strictNullChecks: false })).not.toContain('TSD001');
  });
});

describe('the strict family', () => {
  const cases: [string, (typeof STRICT_FAMILY)[number]][] = [
    ['TSD002', 'strictNullChecks'],
    ['TSD003', 'noImplicitAny'],
    ['TSD004', 'strictFunctionTypes'],
    ['TSD005', 'strictPropertyInitialization'],
    ['TSD006', 'useUnknownInCatchVariables'],
    ['TSD007', 'strictBindCallApply'],
    ['TSD008', 'noImplicitThis'],
    ['TSD009', 'alwaysStrict'],
  ];

  for (const [code, option] of cases) {
    it(`${code} fires when ${option} is explicitly false`, () => {
      expect(cleanCodes({ [option]: false })).toContain(code);
    });

    it(`${code} fires when strict is absent`, () => {
      expect(cleanCodes({ strict: undefined })).toContain(code);
    });

    it(`${code} stays quiet when ${option} is on despite strict being off`, () => {
      expect(cleanCodes({ strict: false, [option]: true })).not.toContain(code);
    });
  }

  it('blames the option when it is explicitly false', () => {
    expect(findByCode(findings({ strictNullChecks: false }), 'TSD002')?.option).toBe(
      'strictNullChecks',
    );
  });

  it('blames strict when the flag is merely absent', () => {
    expect(findByCode(findings({ strict: undefined }), 'TSD002')?.option).toBe('strict');
  });

  it('explains that the flag has no default of its own', () => {
    expect(findByCode(findings({ strict: undefined }), 'TSD002')?.consequence).toContain(
      'no default of its own',
    );
  });
});

describe('checks outside the strict family', () => {
  it('TSD010 fires when noUncheckedIndexedAccess is absent', () => {
    expect(cleanCodes({ noUncheckedIndexedAccess: undefined })).toContain('TSD010');
  });

  it('TSD010 stays quiet when strictNullChecks is off, since it would do nothing', () => {
    expect(cleanCodes({ strict: false, noUncheckedIndexedAccess: undefined })).not.toContain(
      'TSD010',
    );
  });

  it('TSD011 fires when exactOptionalPropertyTypes is absent', () => {
    expect(cleanCodes({ exactOptionalPropertyTypes: undefined })).toContain('TSD011');
  });

  it('TSD011 stays quiet without strictNullChecks', () => {
    expect(cleanCodes({ strict: false, exactOptionalPropertyTypes: undefined })).not.toContain(
      'TSD011',
    );
  });

  it('TSD012 fires when noImplicitOverride is absent', () => {
    expect(cleanCodes({ noImplicitOverride: undefined })).toContain('TSD012');
  });

  it('TSD013 fires when noFallthroughCasesInSwitch is absent', () => {
    expect(cleanCodes({ noFallthroughCasesInSwitch: undefined })).toContain('TSD013');
  });

  it('TSD014 fires when noImplicitReturns is absent', () => {
    expect(cleanCodes({ noImplicitReturns: undefined })).toContain('TSD014');
  });

  it('TSD015 fires when noPropertyAccessFromIndexSignature is absent', () => {
    expect(cleanCodes({ noPropertyAccessFromIndexSignature: undefined })).toContain('TSD015');
  });

  it('TSD016 fires for strictPropertyInitialization without strictNullChecks', () => {
    expect(cleanCodes({ strict: false, strictPropertyInitialization: true })).toContain('TSD016');
  });

  it('TSD016 stays quiet when strictNullChecks is on', () => {
    expect(cleanCodes({ strictPropertyInitialization: true })).not.toContain('TSD016');
  });

  it('TSD017 fires for skipLibCheck', () => {
    expect(cleanCodes({ skipLibCheck: true })).toContain('TSD017');
  });

  it('TSD018 fires for allowJs without checkJs', () => {
    expect(cleanCodes({ allowJs: true })).toContain('TSD018');
  });

  it('TSD018 stays quiet when checkJs is on', () => {
    expect(cleanCodes({ allowJs: true, checkJs: true })).not.toContain('TSD018');
  });

  it('TSD019 fires once for allowUnreachableCode', () => {
    expect(cleanCodes({ allowUnreachableCode: true }).filter((c) => c === 'TSD019')).toHaveLength(
      1,
    );
  });

  it('TSD019 fires twice when both suppressions are on', () => {
    const codes = cleanCodes({ allowUnreachableCode: true, allowUnusedLabels: true });
    expect(codes.filter((code) => code === 'TSD019')).toHaveLength(2);
  });

  it('TSD019 stays quiet when the options are explicitly false', () => {
    expect(cleanCodes({ allowUnreachableCode: false, allowUnusedLabels: false })).not.toContain(
      'TSD019',
    );
  });
});

describe('modules and interop', () => {
  it('TSD020 fires when esModuleInterop is absent under a bundler module setting', () => {
    expect(
      cleanCodes({ module: 'esnext', moduleResolution: 'bundler', esModuleInterop: undefined }),
    ).toContain('TSD020');
  });

  it('TSD020 stays quiet under nodenext, which turns interop on by default', () => {
    expect(cleanCodes({ esModuleInterop: undefined })).not.toContain('TSD020');
  });

  it('TSD021 fires for allowSyntheticDefaultImports without esModuleInterop', () => {
    const codes = cleanCodes({
      module: 'esnext',
      moduleResolution: 'bundler',
      esModuleInterop: false,
      allowSyntheticDefaultImports: true,
    });
    expect(codes).toContain('TSD021');
  });

  it('TSD021 stays quiet when esModuleInterop is on', () => {
    expect(cleanCodes({ allowSyntheticDefaultImports: true })).not.toContain('TSD021');
  });

  it('TSD021 stays quiet under nodenext', () => {
    expect(
      cleanCodes({ esModuleInterop: undefined, allowSyntheticDefaultImports: true }),
    ).not.toContain('TSD021');
  });

  it('TSD022 fires for node10 resolution with a modern module setting', () => {
    expect(cleanCodes({ module: 'esnext', moduleResolution: 'node10' })).toContain('TSD022');
  });

  it('TSD022 names both settings in its explanation', () => {
    const finding = findByCode(findings({ module: 'esnext', moduleResolution: 'node10' }), 'TSD022');
    expect(finding?.consequence).toContain('node10');
    expect(finding?.consequence).toContain('esnext');
  });

  it('TSD022 stays quiet for a commonjs project', () => {
    expect(cleanCodes({ module: 'commonjs', moduleResolution: 'node10' })).not.toContain('TSD022');
  });

  it('TSD023 fires when module is unset', () => {
    expect(cleanCodes({ module: undefined, moduleResolution: 'bundler' })).toContain('TSD023');
  });

  it('TSD024 fires when verbatimModuleSyntax is absent', () => {
    expect(cleanCodes({ verbatimModuleSyntax: undefined })).toContain('TSD024');
  });

  it('TSD025 fires when isolatedModules is absent', () => {
    expect(cleanCodes({ isolatedModules: undefined })).toContain('TSD025');
  });

  it('TSD026 fires when moduleDetection is absent', () => {
    expect(cleanCodes({ moduleDetection: undefined })).toContain('TSD026');
  });

  it('TSD026 fires when moduleDetection is explicitly auto', () => {
    expect(cleanCodes({ moduleDetection: 'auto' })).toContain('TSD026');
  });

  it('TSD027 fires when .ts imports are allowed in a project that emits', () => {
    expect(cleanCodes({ noEmit: undefined, allowImportingTsExtensions: true })).toContain('TSD027');
  });

  it('TSD027 stays quiet under noEmit', () => {
    expect(cleanCodes({ allowImportingTsExtensions: true })).not.toContain('TSD027');
  });

  it('TSD027 stays quiet with emitDeclarationOnly', () => {
    expect(
      cleanCodes({ noEmit: undefined, emitDeclarationOnly: true, allowImportingTsExtensions: true }),
    ).not.toContain('TSD027');
  });

  it('TSD027 stays quiet when tsc rewrites the extensions', () => {
    expect(
      cleanCodes({
        noEmit: undefined,
        allowImportingTsExtensions: true,
        rewriteRelativeImportExtensions: true,
      }),
    ).not.toContain('TSD027');
  });

  it('TSD028 fires for resolveJsonModule under classic resolution', () => {
    expect(
      cleanCodes({ module: 'esnext', moduleResolution: 'classic', resolveJsonModule: true }),
    ).toContain('TSD028');
  });

  it('TSD028 stays quiet under a modern resolver', () => {
    expect(cleanCodes({ resolveJsonModule: true })).not.toContain('TSD028');
  });

  it('TSD029 warns about paths in a project that emits', () => {
    const finding = findByCode(
      findings({ noEmit: undefined, paths: { '@app/*': ['src/*'] } }),
      'TSD029',
    );
    expect(finding?.severity).toBe('warning');
    expect(finding?.consequence).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('TSD029 softens to a note when the project does not emit', () => {
    expect(findByCode(findings({ paths: { '@app/*': ['src/*'] } }), 'TSD029')?.severity).toBe(
      'info',
    );
  });
});

describe('target and emit', () => {
  it('TSD040 fires when target is unset, and says it means ES5', () => {
    const finding = findByCode(findings({ target: undefined }), 'TSD040');
    expect(finding?.title).toContain('ES5');
  });

  it('TSD041 fires for a target below ES2020', () => {
    expect(cleanCodes({ target: 'es2017' })).toContain('TSD041');
  });

  it('TSD041 stays quiet at ES2020', () => {
    expect(cleanCodes({ target: 'es2020' })).not.toContain('TSD041');
  });

  it('TSD041 treats es6 as es2015', () => {
    expect(cleanCodes({ target: 'es6' })).toContain('TSD041');
  });

  it('TSD041 accepts an upper-case target spelling', () => {
    expect(cleanCodes({ target: 'ES2022' })).not.toContain('TSD041');
  });

  it('TSD042 replaces TSD041 for the removed ES3 target', () => {
    const codes = cleanCodes({ target: 'es3' });
    expect(codes).toContain('TSD042');
    expect(codes).not.toContain('TSD041');
  });

  it('TSD043 fires when useDefineForClassFields is left implicit', () => {
    expect(cleanCodes({ useDefineForClassFields: undefined })).toContain('TSD043');
  });

  it('TSD043 reports define semantics at ES2022', () => {
    const finding = findByCode(findings({ useDefineForClassFields: undefined }), 'TSD043');
    expect(finding?.title).toContain('are currently define');
  });

  it('TSD043 reports assignment semantics below ES2022', () => {
    const finding = findByCode(
      findings({ target: 'es2019', useDefineForClassFields: undefined }),
      'TSD043',
    );
    expect(finding?.title).toContain('are currently assignment');
  });

  it('TSD044 fires when an emitting project has no outDir', () => {
    expect(cleanCodes({ noEmit: undefined })).toContain('TSD044');
  });

  it('TSD044 stays quiet when outFile is used instead', () => {
    expect(cleanCodes({ noEmit: undefined, outFile: 'bundle.js' })).not.toContain('TSD044');
  });

  it('TSD045 fires for outDir without rootDir', () => {
    expect(cleanCodes({ noEmit: undefined, outDir: 'dist' })).toContain('TSD045');
  });

  it('TSD045 stays quiet once rootDir is set', () => {
    expect(cleanCodes({ noEmit: undefined, outDir: 'dist', rootDir: 'src' })).not.toContain(
      'TSD045',
    );
  });

  it('TSD046 fires for declaration without declarationMap', () => {
    expect(cleanCodes({ declaration: true })).toContain('TSD046');
  });

  it('TSD046 fires for composite without declarationMap', () => {
    expect(cleanCodes({ composite: true })).toContain('TSD046');
  });

  it('TSD047 fires for an emitting project with no source maps', () => {
    expect(cleanCodes({ noEmit: undefined })).toContain('TSD047');
  });

  it('TSD047 accepts inline source maps', () => {
    expect(cleanCodes({ noEmit: undefined, inlineSourceMap: true })).not.toContain('TSD047');
  });

  it('TSD048 fires for incremental without an explicit tsBuildInfoFile', () => {
    expect(cleanCodes({ incremental: true })).toContain('TSD048');
  });

  it('TSD048 stays quiet once the path is chosen', () => {
    expect(cleanCodes({ incremental: true, tsBuildInfoFile: 'build/.tsbuildinfo' })).not.toContain(
      'TSD048',
    );
  });

  it('TSD049 fires when emit survives a failed type check', () => {
    expect(cleanCodes({ noEmit: undefined })).toContain('TSD049');
  });

  it('TSD050 fires whenever lib is set, and notes a missing dom', () => {
    const finding = findByCode(findings({ lib: ['ES2022'] }), 'TSD050');
    expect(finding?.consequence).toContain('no `dom` entry');
  });

  it('TSD050 still fires with dom present, because lib replaces the defaults', () => {
    const finding = findByCode(findings({ lib: ['ES2022', 'DOM'] }), 'TSD050');
    expect(finding?.consequence).toContain('replaces the target defaults entirely');
  });

  it('TSD051 fires for the classic jsx runtime', () => {
    expect(cleanCodes({ jsx: 'react' })).toContain('TSD051');
  });

  it('TSD051 stays quiet for the automatic runtime', () => {
    expect(cleanCodes({ jsx: 'react-jsx' })).not.toContain('TSD051');
  });

  it('TSD052 fires for experimentalDecorators', () => {
    expect(cleanCodes({ experimentalDecorators: true })).toContain('TSD052');
  });

  it('TSD053 fires for metadata without the legacy decorators', () => {
    expect(cleanCodes({ emitDecoratorMetadata: true })).toContain('TSD053');
  });

  it('TSD053 stays quiet when both are set', () => {
    expect(
      cleanCodes({ emitDecoratorMetadata: true, experimentalDecorators: true }),
    ).not.toContain('TSD053');
  });

  it('TSD054 fires below ES2015 without downlevelIteration', () => {
    expect(cleanCodes({ target: 'es5' })).toContain('TSD054');
  });

  it('TSD054 stays quiet once downlevelIteration is on', () => {
    expect(cleanCodes({ target: 'es5', downlevelIteration: true })).not.toContain('TSD054');
  });

  it('TSD054 stays quiet at ES2015 and above', () => {
    expect(cleanCodes({ target: 'es2015' })).not.toContain('TSD054');
  });
});

describe('program inputs', () => {
  it('TSD060 fires when neither include nor files is given', () => {
    expect(cleanCodes({}, {})).toContain('TSD060');
  });

  it('TSD060 stays quiet when files is given instead of include', () => {
    expect(cleanCodes({}, { files: ['src/index.ts'] })).not.toContain('TSD060');
  });

  it('TSD061 says an empty types list removes everything', () => {
    expect(findByCode(findings({ types: [] }), 'TSD061')?.title).toContain('removes every');
  });

  it('TSD061 counts the packages that remain', () => {
    expect(findByCode(findings({ types: ['node'] }), 'TSD061')?.title).toContain('1 `@types`');
  });

  it('TSD061 pluralises correctly', () => {
    expect(findByCode(findings({ types: ['node', 'vitest'] }), 'TSD061')?.title).toContain(
      '2 `@types` packages',
    );
  });

  it('TSD062 fires only when casing enforcement is explicitly disabled', () => {
    expect(cleanCodes({ forceConsistentCasingInFileNames: false })).toContain('TSD062');
    expect(cleanCodes({ forceConsistentCasingInFileNames: true })).not.toContain('TSD062');
    expect(cleanCodes()).not.toContain('TSD062');
  });

  it('TSD063 fires for an exclude that can only apply to include', () => {
    expect(cleanCodes({}, { files: ['src/index.ts'], exclude: ['src/legacy'] })).toContain(
      'TSD063',
    );
  });

  it('TSD063 stays quiet when include is present', () => {
    expect(
      cleanCodes({}, { files: ['a.ts'], include: ['src'], exclude: ['src/legacy'] }),
    ).not.toContain('TSD063');
  });

  it('TSD064 fires when an explicit exclude forgets outDir', () => {
    expect(cleanCodes({ outDir: 'dist' }, { include: ['src'], exclude: ['node_modules'] })).toContain(
      'TSD064',
    );
  });

  it('TSD064 stays quiet once outDir is listed', () => {
    expect(
      cleanCodes({ outDir: 'dist' }, { include: ['src'], exclude: ['node_modules', 'dist'] }),
    ).not.toContain('TSD064');
  });

  it('TSD064 accepts a glob spelling of the same directory', () => {
    expect(
      cleanCodes({ outDir: './dist' }, { include: ['src'], exclude: ['dist/**'] }),
    ).not.toContain('TSD064');
  });

  it('TSD064 stays quiet with no explicit exclude, since the default covers outDir', () => {
    expect(cleanCodes({ outDir: 'dist' })).not.toContain('TSD064');
  });

  it('TSD065 fires when typeRoots replaces the default search', () => {
    expect(cleanCodes({ typeRoots: ['./types'] })).toContain('TSD065');
  });
});

describe('structure and deprecations', () => {
  it('TSD080 fires when references are declared without composite', () => {
    const config = fromFiles({
      '/p/tsconfig.json': JSON.stringify({
        compilerOptions: clean(),
        include: ['src'],
        references: [{ path: './a' }],
      }),
      '/p/a/tsconfig.json': '{"compilerOptions":{"composite":true}}',
    });
    expect(analyze(config).map((f) => f.code)).toContain('TSD080');
  });

  it('TSD080 stays quiet in a composite project', () => {
    const config = fromFiles({
      '/p/tsconfig.json': JSON.stringify({
        compilerOptions: clean({ composite: true, declarationMap: true }),
        include: ['src'],
        references: [{ path: './a' }],
      }),
      '/p/a/tsconfig.json': '{"compilerOptions":{"composite":true}}',
    });
    expect(analyze(config).map((f) => f.code)).not.toContain('TSD080');
  });

  it('TSD081 fires for composite with declarations turned off', () => {
    expect(cleanCodes({ composite: true, declaration: false })).toContain('TSD081');
  });

  it('TSD082 fires once per deprecated option', () => {
    const codes = cleanCodes({ charset: 'utf8', out: 'bundle.js' });
    expect(codes.filter((code) => code === 'TSD082')).toHaveLength(2);
  });

  it('TSD082 is an error by default', () => {
    expect(findByCode(findings({ charset: 'utf8' }), 'TSD082')?.severity).toBe('error');
  });

  // Changed during the production-readiness audit: this used to expect a
  // warning ("failure postponed to 6.0"). Measured against real compilers,
  // `ignoreDeprecations: "5.0"` silences these options only up to TypeScript
  // 5.5; 5.6.3 through 5.9.3 reject them with TS5102 regardless
  // (see test/tsc-claims.test.ts), so the finding stays an error.
  it('TSD082 stays an error under ignoreDeprecations, and says why', () => {
    const finding = findByCode(
      findings({ charset: 'utf8', ignoreDeprecations: '5.0' }),
      'TSD082',
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.consequence).toContain('only helps on 5.5 and older');
  });

  it('TSD082 covers every option in the deprecation table', () => {
    for (const option of DEPRECATED_OPTIONS.keys()) {
      expect(cleanCodes({ [option]: 'x' }), option).toContain('TSD082');
    }
  });

  it('TSD083 fires for a misspelled option and names it', () => {
    const finding = findByCode(findings({ strictNullCheck: true }), 'TSD083');
    expect(finding?.title).toContain('strictNullCheck');
    expect(finding?.option).toBe('strictNullCheck');
  });

  it('TSD083 accepts every option in the known list', () => {
    for (const option of KNOWN_OPTIONS) {
      expect(cleanCodes({ [option]: true }).includes('TSD083'), option).toBe(false);
    }
  });

  it('TSD084 fires for an inherited relative outDir', () => {
    const config = fromFiles({
      '/p/base/tsconfig.base.json': JSON.stringify({
        compilerOptions: { ...clean({ noEmit: undefined }), outDir: './dist', rootDir: './src' },
      }),
      '/p/packages/api/tsconfig.json': '{"extends":"../../base/tsconfig.base.json","include":["src"]}',
    }, '/p/packages/api/tsconfig.json');
    const codes = analyze(config).map((f) => f.code);
    expect(codes.filter((code) => code === 'TSD084')).toHaveLength(2);
  });

  it('TSD084 stays quiet when the child overrides the path itself', () => {
    const config = fromFiles({
      '/p/base.json': JSON.stringify({ compilerOptions: { ...clean(), outDir: './dist' } }),
      '/p/tsconfig.json':
        '{"extends":"./base.json","compilerOptions":{"outDir":"./build"},"include":["src"]}',
    });
    expect(analyze(config).map((f) => f.code)).not.toContain('TSD084');
  });

  it('TSD084 stays quiet for an inherited absolute path', () => {
    const config = fromFiles({
      '/p/base.json': JSON.stringify({ compilerOptions: { ...clean(), outDir: '/out' } }),
      '/p/tsconfig.json': '{"extends":"./base.json","include":["src"]}',
    });
    expect(analyze(config).map((f) => f.code)).not.toContain('TSD084');
  });

  it('TSD085 fires when a child turns inherited strictness back off', () => {
    const config = fromFiles({
      '/p/base.json': JSON.stringify({ compilerOptions: clean() }),
      '/p/tsconfig.json':
        '{"extends":"./base.json","compilerOptions":{"strict":false},"include":["src"]}',
    });
    const finding = findByCode(analyze(config), 'TSD085');
    expect(finding?.consequence).toContain('/p/base.json');
  });

  it('TSD085 stays quiet when strict is false in a config with no base', () => {
    expect(cleanCodes({ strict: false })).not.toContain('TSD085');
  });
});
