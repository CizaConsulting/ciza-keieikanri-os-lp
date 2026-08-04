import fs from 'node:fs/promises';
import path from 'node:path';
import {
  blocksToMarkdown, findProperty, getAllBlocks, getTitle, makeProperty,
  queryDataSource, requireEnv, retrieveDataSource, slugIsSafe,
} from './lib.mjs';

const draftId = requireEnv('NOTION_ARTICLE_DRAFT_DATA_SOURCE_ID');
const approvedStatus = process.env.NOTION_APPROVED_STATUS || '承認';
const publishedStatus = process.env.NOTION_PUBLISHED_STATUS || '公開済';
const targetSite = process.env.NOTION_TARGET_SITE || '経営管理';
const expectedHost = process.env.EXPECTED_PUBLIC_HOST || 'keieikanri.ciza.co.jp';
const siteUrl = (process.env.PUBLIC_SITE_URL || `https://${expectedHost}`).replace(/\/$/, '');
const blogDir = process.env.BLOG_CONTENT_DIR || 'src/content/blog';

const parsedSiteUrl = new URL(siteUrl);
if (parsedSiteUrl.hostname !== expectedHost) {
  throw new Error(`PUBLIC_SITE_URL host mismatch: expected ${expectedHost}, got ${parsedSiteUrl.hostname}`);
}

const schema = await retrieveDataSource(draftId);
const statusName = findProperty(schema, ['ステータス', 'Status'], 'status')
  || findProperty(schema, ['ステータス', 'Status'], 'select');
const siteName = findProperty(schema, ['サイト', '投稿先'], 'select');
if (!statusName) throw new Error('Article draft database has no status/select property');
if (!siteName) throw new Error('Common article database must have a select property named サイト');
const statusType = schema.properties[statusName].type;

const statusFilter = statusType === 'status'
  ? { property: statusName, status: { equals: approvedStatus } }
  : { property: statusName, select: { equals: approvedStatus } };

const result = await queryDataSource(draftId, {
  page_size: 10,
  filter: {
    and: [
      statusFilter,
      { property: siteName, select: { equals: targetSite } },
    ],
  },
  sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
});

if (!result.results?.length) {
  console.log(JSON.stringify({ published: false, site: targetSite, reason: 'No approved article found' }));
  process.exit(0);
}

// One article per run keeps review and rollback simple.
const page = result.results[0];
const pageSite = page.properties?.[siteName]?.select?.name || '';
if (pageSite !== targetSite) throw new Error(`Site mismatch: expected ${targetSite}, got ${pageSite || '(empty)'}`);

const markdown = blocksToMarkdown(await getAllBlocks(page.id)).trim();
if (!markdown.startsWith('---')) throw new Error(`Approved article "${getTitle(page)}" has no frontmatter`);

const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
if (!frontmatterMatch) throw new Error('Invalid frontmatter');
const titleMatch = frontmatterMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
if (!titleMatch) throw new Error('Frontmatter is missing title');

let slug = '';
for (const name of ['スラッグ', 'slug', 'Slug']) {
  const prop = page.properties?.[name];
  if (prop?.type === 'rich_text') slug = prop.rich_text?.map((v) => v.plain_text).join('') || '';
  if (slug) break;
}
if (!slug) {
  const slugMatch = frontmatterMatch[1].match(/^slug:\s*["']?(.+?)["']?\s*$/m);
  slug = slugMatch?.[1] || '';
}
if (!slugIsSafe(slug)) throw new Error(`Missing or unsafe slug: ${slug}`);

await fs.mkdir(blogDir, { recursive: true });
const filePath = path.join(blogDir, `${slug}.md`);
try {
  await fs.access(filePath);
  throw new Error(`Article file already exists: ${filePath}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await fs.writeFile(filePath, `${markdown}\n`, 'utf8');

const publishedUrl = `${siteUrl}/blog/${slug}`;
if (new URL(publishedUrl).hostname !== expectedHost) throw new Error('Published URL host safety check failed');

const updates = { [statusName]: makeProperty(statusType, publishedStatus) };
const publishedDateName = findProperty(schema, ['公開日', 'Published date'], 'date');
const publishedUrlName = findProperty(schema, ['公開URL', 'Published URL'], 'url');
if (publishedDateName) updates[publishedDateName] = makeProperty('date', new Date().toISOString().slice(0, 10));
if (publishedUrlName) updates[publishedUrlName] = makeProperty('url', publishedUrl);

await fs.writeFile('.blog-publish-result.json', JSON.stringify({
  page_id: page.id,
  site: targetSite,
  title: getTitle(page) || titleMatch[1],
  slug,
  file_path: filePath,
  published_url: publishedUrl,
  notion_updates: updates,
}, null, 2));

console.log(JSON.stringify({ prepared: true, site: targetSite, title: getTitle(page), slug, file_path: filePath }, null, 2));
