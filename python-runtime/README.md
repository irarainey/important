# Python Runtime

This directory was previously used for bundled Python runtimes. The extension now uses a **native TypeScript implementation** for all import validation and sorting - no Python required.

## Current Status

**Not currently used.** All import validation and sorting is done natively in TypeScript for better performance and simpler deployment.

The directory structure is preserved for potential future use if Python-based tools are added.

## Historical Structure

```
python-runtime/
├── win/           # Windows runtime
│   └── ...
├── linux/         # Linux runtime
│   └── ...
└── darwin/        # macOS runtime
    └── ...
```

## Why Native TypeScript?

Using native TypeScript instead of bundled Python:

- No runtime dependencies
- Faster execution
- Simpler deployment
- Smaller extension size
