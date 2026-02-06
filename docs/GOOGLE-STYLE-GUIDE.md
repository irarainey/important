2.2 Imports
Use import statements for packages and modules only, not for individual types, classes, or functions.

2.2.1 Definition
Reusability mechanism for sharing code from one module to another.

2.2.2 Pros
The namespace management convention is simple. The source of each identifier is indicated in a consistent way; x.Obj says that object Obj is defined in module x.

2.2.3 Cons
Module names can still collide. Some module names are inconveniently long.

2.2.4 Decision
Use import x for importing packages and modules.
Use from x import y where x is the package prefix and y is the module name with no prefix.

Use from x import y as z in any of the following circumstances:

Two modules named y are to be imported.
y conflicts with a top-level name defined in the current module.
y conflicts with a common parameter name that is part of the public API (e.g., features).

y is an inconveniently long name.
y is too generic in the context of your code (e.g., from storage.file_system import options as fs_options).

Use import y as z only when z is a standard abbreviation (e.g., import numpy as np).
For example the module sound.effects.echo may be imported as follows:

from sound.effects import echo
...
echo.EchoFilter(input, output, delay=0.7, atten=4)
Do not use relative names in imports. Even if the module is in the same package, use the full package name. This helps prevent unintentionally importing a package twice.

2.2.4.1 Exemptions
Exemptions from this rule:

Symbols from the following modules are used to support static analysis and type checking:
typing module
collections.abc module
typing_extensions module
Redirects from the six.moves module.

This style guide should be considered a superset of the PEP 8 style guide. For more information on imports, see the PEP 8 style guide section on imports at [PEP 8 - Imports](./PEP8.md).
