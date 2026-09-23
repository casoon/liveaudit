import { docsCollection } from "@casoon/pages-theme/content";

// Sources: site/docs. The repository's own docs/ is internal living documentation
// (project-state, architecture, decisions) and is not published here.
export const collections = { docs: docsCollection({ base: "./docs" }) };
