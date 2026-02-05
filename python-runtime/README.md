# Python Runtime

This directory contains bundled Python runtimes with `isort` for cross-platform import sorting.

## Building Runtimes

Use the npm script to download and set up Python runtimes for all platforms:

```bash
npm run build:runtime
```

Or for specific platforms:

```bash
npm run build:runtime -- linux darwin
```

## Directory Structure

```
python-runtime/
├── linux/         # Linux x86_64 runtime
├── darwin/        # macOS x86_64 runtime
├── darwin-arm64/  # macOS ARM64 runtime
└── win/           # Windows x86_64 runtime
```

## Current Status

The extension currently uses **native TypeScript** for import validation.
The Python runtimes are bundled for future `isort` integration.
