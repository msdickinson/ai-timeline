/**
 * Live data sources — drop-in plugins that push trajectory updates as they
 * happen, vs the file-drop parsers which load a static snapshot.
 *
 * Each source self-registers in the registry on import. plugins.ts only
 * needs to `import "./sources"` (this file) to wire them all up.
 */

import "./vett-live";
import "./claude-code-live";
