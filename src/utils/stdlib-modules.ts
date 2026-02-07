/**
 * Python standard library modules for Python 3.11–3.12.
 * 
 * This is the **union** of both versions' `sys.stdlib_module_names` so that
 * modules present in either version are correctly categorised as stdlib.
 * Modules removed in 3.12 are kept for 3.11 users.
 * 
 * Maintained separately for easier updates when Python versions change.
 * 
 * @see https://docs.python.org/3/library/index.html
 */

/**
 * Top-level standard library module names (public, non-underscore-prefixed).
 */
const STDLIB_MODULE_LIST: readonly string[] = [
    // Special: __future__ is a stdlib module used for feature directives
    '__future__',

    // A
    'abc', 'aifc', 'antigravity', 'argparse', 'array', 'ast', 'asynchat',
    'asyncio', 'asyncore', 'atexit', 'audioop',

    // B
    'base64', 'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2',

    // C
    'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code', 'codecs',
    'codeop', 'collections', 'colorsys', 'compileall', 'concurrent',
    'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg', 'cProfile',
    'crypt', 'csv', 'ctypes', 'curses',

    // D
    'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis', 'distutils',
    'doctest',

    // E
    'email', 'encodings', 'ensurepip', 'enum', 'errno',

    // F
    'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch', 'fractions',
    'ftplib', 'functools',

    // G
    'gc', 'genericpath', 'getopt', 'getpass', 'gettext', 'glob', 'graphlib',
    'grp', 'gzip',

    // H
    'hashlib', 'heapq', 'hmac', 'html', 'http',

    // I
    'idlelib', 'imaplib', 'imghdr', 'imp', 'importlib', 'inspect', 'io',
    'ipaddress', 'itertools',

    // J-K
    'json', 'keyword',

    // L
    'lib2to3', 'linecache', 'locale', 'logging', 'lzma',

    // M
    'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder',
    'msvcrt', 'multiprocessing',

    // N
    'netrc', 'nis', 'nntplib', 'nt', 'ntpath', 'nturl2path', 'numbers',

    // O
    'opcode', 'operator', 'optparse', 'os', 'ossaudiodev',

    // P
    'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil', 'platform',
    'plistlib', 'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats',
    'pty', 'pwd', 'py_compile', 'pyclbr', 'pydoc', 'pydoc_data', 'pyexpat',

    // Q
    'queue', 'quopri',

    // R
    'random', 're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy',

    // S
    'sched', 'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil',
    'signal', 'site', 'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver',
    'spwd', 'sqlite3', 'sre_compile', 'sre_constants', 'sre_parse', 'ssl',
    'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess',
    'sunau', 'symtable', 'sys', 'sysconfig', 'syslog',

    // T
    'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'test',
    'textwrap', 'this', 'threading', 'time', 'timeit', 'tkinter', 'token',
    'tokenize', 'tomllib', 'trace', 'traceback', 'tracemalloc', 'tty',
    'turtle', 'turtledemo', 'types', 'typing',

    // U
    'unicodedata', 'unittest', 'urllib', 'uu', 'uuid',

    // V
    'venv',

    // W
    'warnings', 'wave', 'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref',

    // X
    'xdrlib', 'xml', 'xmlrpc',

    // Z
    'zipapp', 'zipfile', 'zipimport', 'zlib', 'zoneinfo',
];

/**
 * Common submodules that should also be recognized as stdlib.
 *
 * Note: `typing_extensions` is a third-party package (PyPI), NOT stdlib.
 * It is exempt from Rule 4 (import-modules-not-symbols) per 2.2.4.1,
 * but it belongs in the third-party import group.
 */
const STDLIB_SUBMODULES: readonly string[] = [
    'os.path',
    'collections.abc',
];

/**
 * Set of all standard library modules for fast lookup.
 */
const STDLIB_MODULES: ReadonlySet<string> = new Set([
    ...STDLIB_MODULE_LIST,
    ...STDLIB_SUBMODULES,
]);

/**
 * Checks if a module name is part of the Python standard library.
 */
export function isStdlibModule(moduleName: string): boolean {
    const topLevel = moduleName.split('.')[0];
    return STDLIB_MODULES.has(topLevel) || STDLIB_MODULES.has(moduleName);
}
