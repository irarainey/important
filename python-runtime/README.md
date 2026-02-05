# Python Runtime

This directory is reserved for bundled Python runtimes for future `isort` integration.

## Current Status

The extension currently uses **native TypeScript** for all import validation and sorting. No Python runtime is required.

## Building Runtimes (Future Use)

Use the npm script to download and set up Python runtimes for all platforms:

```bash
npm run build:runtime
```

Or for specific platforms:

```bash
npm run build:runtime -- linux darwin
```

## Directory Structure

When built, the structure will be:

```
python-runtime/
├── linux/         # Linux x86_64 runtime
├── darwin/        # macOS x86_64 runtime
├── darwin-arm64/  # macOS ARM64 runtime
└── win/           # Windows x86_64 runtime
```
