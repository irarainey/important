Imports

Imports should usually be on separate lines:

# Correct:

import os
import sys

# Wrong:

import sys, os
It’s okay to say this though:

# Correct:

from subprocess import Popen, PIPE
Imports are always put at the top of the file, just after any module comments and docstrings, and before module globals and constants.
Imports should be grouped in the following order:

Standard library imports.
Related third party imports.
Local application/library specific imports.
You should put a blank line between each group of imports.

Absolute imports are recommended, as they are usually more readable and tend to be better behaved (or at least give better error messages) if the import system is incorrectly configured (such as when a directory inside a package ends up on sys.path):
import mypkg.sibling
from mypkg import sibling
from mypkg.sibling import example
However, explicit relative imports are an acceptable alternative to absolute imports, especially when dealing with complex package layouts where using absolute imports would be unnecessarily verbose:

from . import sibling
from .sibling import example
Standard library code should avoid complex package layouts and always use absolute imports.

When importing a class from a class-containing module, it’s usually okay to spell this:
from myclass import MyClass
from foo.bar.yourclass import YourClass
If this spelling causes local name clashes, then spell them explicitly:

import myclass
import foo.bar.yourclass
and use myclass.MyClass and foo.bar.yourclass.YourClass.

Wildcard imports (from <module> import \*) should be avoided, as they make it unclear which names are present in the namespace, confusing both readers and many automated tools. There is one defensible use case for a wildcard import, which is to republish an internal interface as part of a public API (for example, overwriting a pure Python implementation of an interface with the definitions from an optional accelerator module and exactly which definitions will be overwritten isn’t known in advance).
When republishing names this way, the guidelines below regarding public and internal interfaces still apply.

Module Level Dunder Names
Module level “dunders” (i.e. names with two leading and two trailing underscores) such as **all**, **author**, **version**, etc. should be placed after the module docstring but before any import statements except from **future** imports. Python mandates that future-imports must appear in the module before any other code except docstrings:

"""This is the example module.

This module does stuff.
"""

from **future** import barry_as_FLUFL

**all** = ['a', 'b', 'c']
**version** = '0.1'
**author** = 'Cardinal Biggles'

import os
import sys
