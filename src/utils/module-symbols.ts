/**
 * Known exported symbols for common Python stdlib modules.
 * 
 * Used to fix wildcard imports by scanning for actual symbol usage.
 * Only includes commonly wildcarded modules - add more as needed.
 */

/**
 * Mapping of module names to their exported symbols.
 */
export const MODULE_SYMBOLS: Readonly<Record<string, readonly string[]>> = {
    'os.path': [
        'abspath', 'altsep', 'basename', 'commonpath', 'commonprefix',
        'curdir', 'defpath', 'devnull', 'dirname', 'exists', 'expanduser',
        'expandvars', 'extsep', 'getatime', 'getctime', 'getmtime', 'getsize',
        'isabs', 'isdir', 'isfile', 'islink', 'ismount', 'join', 'lexists',
        'normcase', 'normpath', 'pardir', 'pathsep', 'realpath', 'relpath',
        'samefile', 'sameopenfile', 'samestat', 'sep', 'split', 'splitdrive',
        'splitext', 'supports_unicode_filenames',
    ],
    'pathlib': [
        'Path', 'PosixPath', 'PurePath', 'PurePosixPath', 'PureWindowsPath',
        'WindowsPath',
    ],
    'typing': [
        'AbstractSet', 'Any', 'AnyStr', 'Awaitable', 'BinaryIO', 'Callable',
        'ChainMap', 'ClassVar', 'Collection', 'Concatenate', 'Container',
        'Coroutine', 'Counter', 'DefaultDict', 'Deque', 'Dict', 'Final',
        'FrozenSet', 'Generator', 'Generic', 'Hashable', 'IO', 'ItemsView',
        'Iterable', 'Iterator', 'KeysView', 'List', 'Literal', 'Mapping',
        'MappingView', 'Match', 'MutableMapping', 'MutableSequence',
        'MutableSet', 'NamedTuple', 'NewType', 'NoReturn', 'Optional',
        'OrderedDict', 'ParamSpec', 'Pattern', 'Protocol', 'Reversible',
        'Sequence', 'Set', 'Sized', 'SupportsAbs', 'SupportsBytes',
        'SupportsComplex', 'SupportsFloat', 'SupportsIndex', 'SupportsInt',
        'SupportsRound', 'Text', 'TextIO', 'Tuple', 'Type', 'TypeAlias',
        'TypeGuard', 'TypeVar', 'TypedDict', 'Union', 'ValuesView',
        'cast', 'dataclass_transform', 'final', 'get_args', 'get_origin',
        'get_type_hints', 'is_typeddict', 'no_type_check', 'no_type_check_decorator',
        'overload', 'runtime_checkable', 'TYPE_CHECKING',
    ],
    're': [
        'A', 'ASCII', 'DEBUG', 'DOTALL', 'I', 'IGNORECASE', 'L', 'LOCALE',
        'M', 'MULTILINE', 'Match', 'NOFLAG', 'Pattern', 'RegexFlag', 'S', 'Scanner',
        'T', 'TEMPLATE', 'U', 'UNICODE', 'VERBOSE', 'X', 'compile', 'error',
        'escape', 'findall', 'finditer', 'fullmatch', 'match', 'purge', 'search',
        'split', 'sub', 'subn', 'template',
    ],
    'json': [
        'JSONDecodeError', 'JSONDecoder', 'JSONEncoder', 'dump', 'dumps', 'load', 'loads',
    ],
    'collections': [
        'ChainMap', 'Counter', 'OrderedDict', 'UserDict', 'UserList', 'UserString',
        'abc', 'defaultdict', 'deque', 'namedtuple',
    ],
    'itertools': [
        'accumulate', 'batched', 'chain', 'combinations', 'combinations_with_replacement',
        'compress', 'count', 'cycle', 'dropwhile', 'filterfalse', 'groupby',
        'islice', 'pairwise', 'permutations', 'product', 'repeat', 'starmap',
        'takewhile', 'tee', 'zip_longest',
    ],
    'functools': [
        'WRAPPER_ASSIGNMENTS', 'WRAPPER_UPDATES', 'cache', 'cached_property',
        'cmp_to_key', 'lru_cache', 'partial', 'partialmethod', 'reduce',
        'singledispatch', 'singledispatchmethod', 'total_ordering', 'update_wrapper',
        'wraps',
    ],
    'datetime': [
        'MAXYEAR', 'MINYEAR', 'UTC', 'date', 'datetime', 'time', 'timedelta',
        'timezone', 'tzinfo',
    ],
    'math': [
        'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt',
        'ceil', 'comb', 'copysign', 'cos', 'cosh', 'degrees', 'dist', 'e',
        'erf', 'erfc', 'exp', 'exp2', 'expm1', 'fabs', 'factorial', 'floor',
        'fmod', 'frexp', 'fsum', 'gamma', 'gcd', 'hypot', 'inf', 'isclose',
        'isfinite', 'isinf', 'isnan', 'isqrt', 'lcm', 'ldexp', 'lgamma', 'log',
        'log10', 'log1p', 'log2', 'modf', 'nan', 'nextafter', 'perm', 'pi',
        'pow', 'prod', 'radians', 'remainder', 'sin', 'sinh', 'sqrt', 'sumprod',
        'tan', 'tanh', 'tau', 'trunc', 'ulp',
    ],
    'sys': [
        'abiflags', 'addaudithook', 'argv', 'audit', 'base_exec_prefix',
        'base_prefix', 'breakpointhook', 'builtin_module_names', 'byteorder',
        'call_tracing', 'copyright', 'displayhook', 'dont_write_bytecode',
        'exc_info', 'excepthook', 'exec_prefix', 'executable', 'exit', 'flags',
        'float_info', 'float_repr_style', 'get_asyncgen_hooks',
        'get_coroutine_origin_tracking_depth', 'getallocatedblocks',
        'getdefaultencoding', 'getdlopenflags', 'getfilesystemencodeerrors',
        'getfilesystemencoding', 'getprofile', 'getrecursionlimit', 'getrefcount',
        'getsizeof', 'getswitchinterval', 'gettrace', 'hash_info', 'hexversion',
        'implementation', 'int_info', 'intern', 'maxsize', 'maxunicode', 'meta_path',
        'modules', 'orig_argv', 'path', 'path_hooks', 'path_importer_cache',
        'platform', 'platlibdir', 'prefix', 'ps1', 'ps2', 'pycache_prefix',
        'set_asyncgen_hooks', 'set_coroutine_origin_tracking_depth', 'setdlopenflags',
        'setprofile', 'setrecursionlimit', 'setswitchinterval', 'settrace',
        'stderr', 'stdin', 'stdout', 'stdlib_module_names', 'thread_info',
        'unraisablehook', 'version', 'version_info', 'warnoptions',
    ],
    'os': [
        'CLD_CONTINUED', 'CLD_DUMPED', 'CLD_EXITED', 'CLD_KILLED', 'CLD_STOPPED',
        'CLD_TRAPPED', 'EX_CANTCREAT', 'EX_CONFIG', 'EX_DATAERR', 'EX_IOERR',
        'EX_NOHOST', 'EX_NOINPUT', 'EX_NOPERM', 'EX_NOUSER', 'EX_OK', 'EX_OSERR',
        'EX_OSFILE', 'EX_PROTOCOL', 'EX_SOFTWARE', 'EX_TEMPFAIL', 'EX_UNAVAILABLE',
        'EX_USAGE', 'F_OK', 'GRND_NONBLOCK', 'GRND_RANDOM', 'MFD_ALLOW_SEALING',
        'MFD_CLOEXEC', 'MFD_HUGETLB', 'MFD_HUGE_1GB', 'MFD_HUGE_1MB', 'MFD_HUGE_2GB',
        'MFD_HUGE_2MB', 'MFD_HUGE_8MB', 'MFD_HUGE_16GB', 'MFD_HUGE_16MB',
        'MFD_HUGE_32MB', 'MFD_HUGE_64KB', 'MFD_HUGE_256MB', 'MFD_HUGE_512KB',
        'MFD_HUGE_512MB', 'O_APPEND', 'O_ASYNC', 'O_CLOEXEC', 'O_CREAT', 'O_DIRECT',
        'O_DIRECTORY', 'O_DSYNC', 'O_EXCL', 'O_LARGEFILE', 'O_NDELAY', 'O_NOATIME',
        'O_NOCTTY', 'O_NOFOLLOW', 'O_NONBLOCK', 'O_PATH', 'O_RDONLY', 'O_RDWR',
        'O_RSYNC', 'O_SYNC', 'O_TMPFILE', 'O_TRUNC', 'O_WRONLY',
        'POSIX_SPAWN_CLOSE', 'POSIX_SPAWN_DUP2', 'POSIX_SPAWN_OPEN',
        'P_NOWAIT', 'P_NOWAITO', 'P_WAIT', 'R_OK', 'SEEK_CUR', 'SEEK_END',
        'SEEK_SET', 'W_OK', 'X_OK',
        'abort', 'access', 'altsep', 'chdir', 'chmod', 'chown', 'chroot', 'close',
        'closerange', 'confstr', 'confstr_names', 'cpu_count', 'curdir', 'defpath',
        'device_encoding', 'devnull', 'dup', 'dup2', 'environ', 'environb', 'error',
        'execl', 'execle', 'execlp', 'execlpe', 'execv', 'execve', 'execvp',
        'execvpe', 'extsep', 'fchdir', 'fchmod', 'fchown', 'fdatasync', 'fdopen',
        'fork', 'forkpty', 'fpathconf', 'fsdecode', 'fsencode', 'fspath', 'fstat',
        'fstatvfs', 'fsync', 'ftruncate', 'fwalk', 'get_blocking', 'get_exec_path',
        'get_inheritable', 'get_terminal_size', 'getcwd', 'getcwdb', 'getegid',
        'getenv', 'getenvb', 'geteuid', 'getgid', 'getgrouplist', 'getgroups',
        'getloadavg', 'getlogin', 'getpgid', 'getpgrp', 'getpid', 'getppid',
        'getpriority', 'getrandom', 'getresgid', 'getresuid', 'getsid', 'getuid',
        'getxattr', 'initgroups', 'isatty', 'kill', 'killpg', 'lchflags', 'lchmod',
        'lchown', 'linesep', 'link', 'listdir', 'listxattr', 'lseek', 'lstat',
        'major', 'makedev', 'makedirs', 'memfd_create', 'minor', 'mkdir', 'mkdirat',
        'mkfifo', 'mknod', 'name', 'nice', 'open', 'openpty', 'pardir', 'path',
        'pathconf', 'pathconf_names', 'pathsep', 'pidfd_open', 'pipe', 'pipe2',
        'popen', 'pread', 'preadv', 'putenv', 'pwrite', 'pwritev', 'read', 'readlink',
        'readv', 'register_at_fork', 'remove', 'removedirs', 'removexattr', 'rename',
        'renames', 'replace', 'rmdir', 'scandir', 'sched_get_priority_max',
        'sched_get_priority_min', 'sched_getaffinity', 'sched_getparam',
        'sched_getscheduler', 'sched_param', 'sched_rr_get_interval',
        'sched_setaffinity', 'sched_setparam', 'sched_setscheduler', 'sched_yield',
        'sendfile', 'sep', 'set_blocking', 'set_inheritable', 'setegid', 'seteuid',
        'setgid', 'setgroups', 'setpgid', 'setpgrp', 'setpriority', 'setregid',
        'setresgid', 'setresuid', 'setreuid', 'setsid', 'setuid', 'setxattr', 'spawnl',
        'spawnle', 'spawnlp', 'spawnlpe', 'spawnv', 'spawnve', 'spawnvp', 'spawnvpe',
        'st_mode', 'stat', 'stat_result', 'statvfs', 'statvfs_result', 'strerror',
        'supports_bytes_environ', 'supports_dir_fd', 'supports_effective_ids',
        'supports_fd', 'supports_follow_symlinks', 'symlink', 'sync', 'sysconf',
        'sysconf_names', 'system', 'tcgetpgrp', 'tcsetpgrp', 'terminal_size',
        'times', 'times_result', 'truncate', 'ttyname', 'umask', 'uname',
        'uname_result', 'unlink', 'unsetenv', 'urandom', 'utime', 'wait', 'wait3',
        'wait4', 'waitid', 'waitid_result', 'waitpid', 'waitstatus_to_exitcode',
        'walk', 'write', 'writev',
    ],
} as const;

/**
 * Gets the known exported symbols for a module.
 * 
 * @param moduleName The full module name (e.g., 'os.path')
 * @returns Array of known symbols, or empty array if module not known
 */
export function getModuleSymbols(moduleName: string): readonly string[] {
    return MODULE_SYMBOLS[moduleName] ?? [];
}

/**
 * Checks if a module has known symbol mappings.
 */
export function hasModuleSymbols(moduleName: string): boolean {
    return moduleName in MODULE_SYMBOLS;
}
