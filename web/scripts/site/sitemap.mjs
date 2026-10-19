// /sitemap.xml as an index of one sitemap per page family, so Search Console reports each separately
import { SITE } from './layout.mjs';

const MAX_SITEMAP_URLS = 50_000;

const urlset = (paths, lastmod) => {
  if (paths.length > MAX_SITEMAP_URLS) throw new Error(`Sitemap has ${paths.length} URLs; the limit is ${MAX_SITEMAP_URLS}`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
};

/** `sections` maps a child sitemap's name to its paths; `generatedAt` is the data export's timestamp */
export const sitemapFiles = (sections, generatedAt) => {
  // Every page is regenerated from each data export, so the export date is each page's last change
  const lastmod = generatedAt.split('T')[0];
  const files = new Map();
  for (const [name, paths] of Object.entries(sections)) files.set(`/sitemap-${name}.xml`, urlset(paths, lastmod));
  files.set(
    '/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...files.keys()].map((p) => `  <sitemap><loc>${SITE}${p}</loc><lastmod>${lastmod}</lastmod></sitemap>`).join('\n')}
</sitemapindex>
`,
  );
  return files;
};
