import fs from 'node:fs/promises';
import path from 'node:path';
import {
  blocksToMarkdown, findProperty, getAllBlocks, getTitle, makeProperty,
  queryDataSource, requireEnv, retrieveDataSource, slugIsSafe, updatePage,
} from './lib.mjs';

const draftId = requireEnv('NOTION_ARTICLE_DRAFT_DATA_SOURCE_ID');
const approvedStatus = process.env.NOTION_APPROVED_STATUS || '承認';
const publishedStatus = process.env.NOTION_PUBLISHED_STATUS || '公開済';
const siteUrl = (process.env.PUBLIC_SITE_URL || 'https://keieikanri.ciza.co.jp').replace(/\/$/, '');
const blogDir = process.env.BLOG_CONTENT_DIR || 'src/content/blog';

const schema = await retrieveDataSource(draftId);
const statusName = findProperty(schema, ['ステータス', 'Status'], 'status')
  || findProperty(schema, ['ステータス', 'Status'], 'select');
if (!statusName) throw new Error('Article draft database has no status/select property');
const statusType = schema.properties[statusName].type;

const filter = statusType === 'status'
  ? { property: statusName, status: { equals: approvedStatus } }
  : { property: statusName, select: { equals: approvedStatus } };

const result = await queryDataSource(draftId, {
  page_size: 10,
  filter,
  sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
});

if (!result.results?.length) {
  console.log(JSON.stringify({ published: false, reason: 'No approved article found' }));
  process.exit(0);
}

// One article per weekly run keeps review and rollback simple.
const page = result.results[0];
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
const updates = { [statusName]: makeProperty(statusType, publishedStatus) };
const publishedDateName = findProperty(schema, ['公開日', 'Published date'], 'date');
const publishedUrlName = findProperty(schema, ['公開URL', 'Published URL'], 'url');
if (publishedDateName) updates[publishedDateName] = makeProperty('date', new Date().toISOString().slice(0, 10));
if (publishedUrlName) updates[publishedUrlName] = makeProperty('url', publishedUrl);

// The workflow runs the build before this script is followed by git commit.
// A failed build stops the job, so Notion is updated only by the separate finalize step.
await fs.writeFile('.blog-publish-result.json', JSON.stringify({
  page_id: page.id,
  title: getTitle(page) || titleMatch[1],
  slug,
  file_path: filePath,
  published_url: publishedUrl,
  notion_updates: updates,
}, null, 2));

console.log(JSON.stringify({ prepared: true, title: getTitle(page), slug, file_path: filePath }, null, 2));
