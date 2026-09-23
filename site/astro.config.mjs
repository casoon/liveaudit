// @ts-check
import casoonPages from "@casoon/pages-theme";
import { defineConfig } from "astro/config";

// Project page: https://casoon.github.io/liveaudit/ — `base` is the GitHub Pages path.
export default defineConfig({
  site: "https://casoon.github.io/liveaudit",
  base: "/liveaudit/",
  integrations: [
    casoonPages({
      name: "LiveAudit",
      description:
        "An embedded accessibility inspector: findings on the affected element, on the page as it actually runs.",
      repo: "casoon/liveaudit",
      license: "MIT",
      // The tool only shows what it is once it runs, so the demo takes the place
      // a build-time showcase holds for other projects.
      demo: "Demo",
      showcase: false,
      // Nothing is released yet; a changelog would have nothing to list.
      changelog: false,
      // docs/ in this repository is internal living documentation (project-state,
      // decisions, constraints). What is published lives in site/docs/.
      docsDir: "site/docs",
      docsGroups: {
        "getting-started": "Getting started",
        concepts: "Concepts",
      },
    }),
  ],
});
