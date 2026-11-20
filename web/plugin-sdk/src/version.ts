/**
 * SDK version, the shared library versions, and `sdkVersion` matching with npm semver semantics
 * (docs/plugins/sdk-v0.md and sdk-v1.md, "Versioning").
 *
 * @example
 * satisfies('^1.0.0', SDK_VERSION) // true
 */

/** The version of this SDK. */
export const SDK_VERSION = '1.9.0';

/**
 * The libraries the shell shares with plugins through the import map, with their exact versions
 * (S4). Plugins never bundle them. The build plugin writes these into the manifest's `web.shared`.
 */
export const SHARED_LIBRARIES: Readonly<Record<string, string>> = {
  react: '19.3.0',
  'react-dom': '19.3.0',
  ol: '10.10.0',
  milsymbol: '3.0.4',
  proj4: '2.22.0',
  'lucide-react': '1.49.0',
  '@emc2/plugin-sdk': SDK_VERSION,
};

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

function parse(text: string): Version {
  const m = VERSION.exec(text);
  if (!m) {
    throw new Error(`not a SemVer version: ${text}`);
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? '' };
}

function compare(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePrerelease(a.prerelease, b.prerelease);
}

function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return 1; // a release is greater than its prereleases
  if (b === '') return -1;
  return a < b ? -1 : 1;
}

/**
 * Whether `version` satisfies `range`: an exact version, `^x.y.z`, `~x.y.z` or `>=x.y.z`, with npm
 * semver semantics. A prerelease version matches only a range with the same `x.y.z` and a
 * prerelease. Shared test cases: `model/examples/sdk-version-matching.json`.
 */
export function satisfies(range: string, version: string): boolean {
  const op = range.startsWith('>=') ? '>=' : range.startsWith('^') ? '^' : range.startsWith('~') ? '~' : '';
  const low = parse(range.slice(op.length));
  const v = parse(version);
  if (v.prerelease !== '' && !(low.prerelease !== '' && low.major === v.major && low.minor === v.minor && low.patch === v.patch)) {
    return false;
  }
  if (op === '') return compare(v, low) === 0;
  if (compare(v, low) < 0) return false;
  if (op === '>=') return true;
  if (op === '~') return v.major === low.major && v.minor === low.minor;
  // caret: the left-most non-zero part must not change
  if (low.major > 0) return v.major === low.major;
  if (low.minor > 0) return v.major === 0 && v.minor === low.minor;
  return v.major === 0 && v.minor === 0 && v.patch === low.patch;
}

/** The SDK's own entry in `web.shared`: the shell checks the SDK by the plugin's `sdkVersion` only. */
export const SDK_PACKAGE = '@emc2/plugin-sdk';

/**
 * SDK 1.9.0 (CR-0048 point 2, gap G2; owner PQ3 A): whether a shell that shares `library` at
 * `shells` runs a web part built against `built`. The SDK itself ({@link SDK_PACKAGE}) is always
 * compatible here, since its `sdkVersion` range decides; every other library by the caret of the
 * built version: the same major version, and the shell's at least as new (for a library below
 * 1.0.0 the caret keeps the minor, as {@link satisfies} does). A version that is not SemVer is not
 * compatible. A new major version of a shared library is therefore a breaking change of the web SDK.
 *
 * @example
 * compatibleShared('react', '19.3.0', '19.4.1') // true
 * compatibleShared('react', '19.3.0', '20.0.0') // false
 * compatibleShared('ol', '10.10.0', '10.9.0')   // false: the shell is older
 */
export function compatibleShared(library: string, built: string, shells: string): boolean {
  if (library === SDK_PACKAGE) return true;
  try {
    return satisfies(`^${built}`, shells);
  } catch {
    return false;
  }
}

