// The release's check for a folder that is too deep for Windows (TJ A, M8): start.bat measures the
// folder it runs in and stops with a message that names it, before Java fails on a file it cannot find.

/** Windows' MAX_PATH (260) less the closing NUL: the longest path a program may use without long path support. */
export const WINDOWS_PATH_LIMIT = 259;

/** The length of the longest of `files`, paths relative to the release folder. */
export function deepestLength(files) {
  return files.reduce((max, file) => Math.max(max, file.length), 0);
}

/**
 * The start.bat lines that stop when the release folder (the current directory) is too deep: its length,
 * a backslash and `deepest` (the longest relative path in the release) must stay within the limit.
 */
export function depthCheckLines(deepest) {
  const room = WINDOWS_PATH_LIMIT - 1 - deepest; // the longest folder path that still fits
  return [
    'set "HERE=%CD%"',
    'set /a LEN=0',
    ':depth',
    'if not defined HERE goto depthdone',
    'set "HERE=%HERE:~1%"',
    'set /a LEN+=1',
    'goto depth',
    ':depthdone',
    `if %LEN% LEQ ${room} goto depthok`,
    'echo This folder is too deep for Windows: "%CD%"', // quoted: a folder name may hold & or brackets
    `echo Its path has %LEN% characters, and emcc's files need a folder of at most ${room}: Windows does not find files whose path is longer than 260 characters.`,
    'echo Unpack the zip into a short folder, e.g. C:\\emcc, and start start.bat there.',
    'exit /b 1',
    ':depthok',
  ];
}
