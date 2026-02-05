# Python Runtime

This directory contains bundled standalone Python runtimes with [isort](https://pycqa.github.io/isort/) for import sorting.

## Current Usage

The extension uses:
- **Native TypeScript validation** - all import rule checking is done in TypeScript without Python
- **Bundled isort** - for sorting imports via the "Sort Imports with isort" command

## Structure

```
python-runtime/
├── win/           # Windows runtime
│   ├── python.exe
│   ├── Scripts/
│   │   └── isort.exe
│   └── Lib/
│       └── site-packages/
├── linux/         # Linux runtime
│   ├── bin/
│   │   ├── python3
│   │   └── isort
│   └── lib/
│       └── python3.11/
│           └── site-packages/
└── darwin/        # macOS runtime
    ├── bin/
    │   ├── python3
    │   └── isort
    └── lib/
        └── python3.11/
            └── site-packages/
```

## Building the Runtime

### Option 1: Download Standalone Python (Recommended)

Download pre-built Python distributions for all platforms:

```bash
./scripts/download-python-standalone.sh
```

This uses [python-build-standalone](https://github.com/indygreg/python-build-standalone) releases which are fully portable and don't require Python to be installed on the target machine.

### Option 2: Use Local Python (Quick, Single Platform)

Run the build script on each target platform:

```bash
# On Linux
./scripts/build-python-runtime.sh linux

# On macOS
./scripts/build-python-runtime.sh darwin

# On Windows (Git Bash or WSL)
./scripts/build-python-runtime.sh win
```

## Required Versions

| Component | Version          | Notes               |
| --------- | ---------------- | ------------------- |
| Python    | 3.11.x           | Currently uses 3.11.9 |
| isort     | Latest (7.x)     | Import sorting with Google profile |

## Bundled Packages

| Package | Purpose                                    |
| ------- | ------------------------------------------ |
| `isort` | Sorts imports according to Google style    |

## Why Bundle Python?

Bundling avoids:
- Dependency on user's Python installation
- Proxy/firewall issues in enterprise environments
- Conflicts with project virtualenvs
- Version mismatches

## Licensing

- **Python**: PSF License
- **isort**: MIT License
