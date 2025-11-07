import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import rehypePrettyCode from "rehype-pretty-code";
import { siteConfig } from "./src/config";

import sitemap from "@astrojs/sitemap";

import react from "@astrojs/react";

import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default defineConfig({
  site: siteConfig.site,
  integrations: [tailwind(), sitemap(), react()],
  markdown: {
    rehypePlugins: [
      [
        rehypePrettyCode,
        {
          theme: "github-dark",
          onVisitLine(node) {
            if (node.children.length === 0) {
              node.children = [{ type: "text", value: " " }];
            }
          },
        },
      ],
    ],
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
});
