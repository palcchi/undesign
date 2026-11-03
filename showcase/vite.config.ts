import { defineConfig } from "vite";
import siteContent from "./showcase/content.json";

function escapeAttribute(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

export default defineConfig({
  plugins: [
    {
      name: "content-json-metadata",
      transformIndexHtml(html) {
        return html
          .replaceAll("%%META_TITLE%%", escapeAttribute(siteContent.meta.title))
          .replaceAll("%%META_DESCRIPTION%%", escapeAttribute(siteContent.meta.description))
          .replaceAll("%%META_IMAGE%%", escapeAttribute(siteContent.meta.socialImage))
          .replaceAll("%%META_IMAGE_ALT%%", escapeAttribute(siteContent.meta.socialImageAlt));
      },
    },
  ],
  base: "/",
  appType: "spa",
  server: {
    host: "127.0.0.1",
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: "assets",
  },
});
