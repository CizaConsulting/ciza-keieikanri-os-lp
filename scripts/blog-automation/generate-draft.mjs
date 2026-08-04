import {
  blocksToMarkdown, createPage, findProperty, getAllBlocks, getPageUrl, getTitle,
  makeProperty, markdownToBlocks, openAIJson, queryDataSource, requireEnv,
  retrieveDataSource,
} from './lib.mjs';

const meetingId = requireEnv('NOTION_MEETING_LOG_DATA_SOURCE_ID');
const judgmentId = requireEnv('NOTION_JUDGMENT_LIBRARY_DATA_SOURCE_ID');
const draftId = requireEnv('NOTION_ARTICLE_DRAFT_DATA_SOURCE_ID');
const managementTag = process.env.NOTION_MANAGEMENT_TAG || '経営管理';
const targetSite = process.env.NOTION_TARGET_SITE || '経営管理';
const articleType = process.env.NOTION_ARTICLE_TYPE || '実務解説';

async function pageSummary(page, maxChars = 5000) {
  const blocks = await getAllBlocks(page.id);
  return {
    id: page.id,
    title: getTitle(page),
    url: getPageUrl(page),
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    content: blocksToMarkdown(blocks).slice(0, maxChars),
  };
}

const [meetingSchema, judgmentSchema, draftSchema] = await Promise.all([
  retrieveDataSource(meetingId),
  retrieveDataSource(judgmentId),
  retrieveDataSource(draftId),
]);
const tagProperty = findProperty(meetingSchema, ['タグ', '分類', 'テーマ'], 'multi_select');
const judgmentContextProperty = findProperty(judgmentSchema, ['文脈', 'タグ', 'テーマ'], 'multi_select');
const siteProperty = findProperty(draftSchema, ['サイト', '投稿先'], 'select');
if (!siteProperty) throw new Error('Common article database must have a select property named サイト');
if (!judgmentContextProperty) throw new Error('Judgment library must have a multi-select property named 文脈');

const meetingQuery = {
  page_size: 30,
  sorts: [{ timestamp: 'created_time', direction: 'descending' }],
};
if (tagProperty) meetingQuery.filter = { property: tagProperty, multi_select: { contains: managementTag } };

const judgmentQuery = {
  page_size: 50,
  filter: { property: judgmentContextProperty, multi_select: { contains: managementTag } },
  sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
};

const [meetingResult, judgmentResult, draftResult] = await Promise.all([
  queryDataSource(meetingId, meetingQuery),
  queryDataSource(judgmentId, judgmentQuery),
  queryDataSource(draftId, {
    page_size: 100,
    filter: { property: siteProperty, select: { equals: targetSite } },
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
  }),
]);

if (!meetingResult.results?.length) throw new Error(`No meeting logs found for tag: ${managementTag}`);
if (!judgmentResult.results?.length) throw new Error(`No judgment library entries found for context: ${managementTag}`);

const meetings = await Promise.all(meetingResult.results.slice(0, 12).map((page) => pageSummary(page, 6500)));
const judgments = await Promise.all((judgmentResult.results || []).slice(0, 20).map((page) => pageSummary(page, 2500)));
const existingTitles = (draftResult.results || []).map(getTitle).filter(Boolean);

const instructions = `あなたは株式会社シザコンサルティングの編集者です。川原拓馬の実際の支援事例と判断基準をもとに、経営管理OSブログの記事案を1本作成してください。

目的:
- SEO・AEOで中小・中堅企業の経営者や管理部門に届く
- 訪問者に川原の現場感、考え方、判断基準を知ってもらう

必須ルール:
- 会議ログから最も記事価値の高い1事例を選ぶ
- 判断ライブラリの考え方を1つ以上組み合わせる
- 既存タイトルと論点が重複する記事は避ける
- 1記事1論点。結論を明確にする
- 一般論のまとめではなく「現場の症状→川原の判断→理由→読者への問い」で構成する
- 企業名、個人名、日付、固有の金額など特定につながる情報は匿名化・変更する
- 事実にない成果や発言を作らない
- 2000〜3000字程度
- 見出しはH2中心。タイトルと同じH1を本文に置く
- 最後に匿名化注記と無料経営管理診断へのCTAを置く
- slugは英小文字・数字・ハイフンのみ
- Markdown本文の先頭にAstro用frontmatterを含める
- frontmatterは title, description, keywords, date, author のみ。dateは今日の日付、authorは株式会社シザコンサルティング
- 本文に選定理由や内部メモを書かない`;

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    slug: { type: 'string' },
    description: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 8 },
    source_page_id: { type: 'string' },
    source_title: { type: 'string' },
    source_url: { type: 'string' },
    judgment_titles: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
    markdown: { type: 'string' },
  },
  required: ['title', 'slug', 'description', 'keywords', 'source_page_id', 'source_title', 'source_url', 'judgment_titles', 'markdown'],
};

const article = await openAIJson({
  instructions,
  input: JSON.stringify({ meetings, judgments, existing_titles: existingTitles }, null, 2),
  schema,
  name: 'blog_article_draft',
});

if (!meetings.some((m) => m.id === article.source_page_id)) throw new Error('Model selected an unknown source page');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)) throw new Error(`Unsafe slug: ${article.slug}`);
if (!article.markdown.startsWith('---')) throw new Error('Generated Markdown is missing frontmatter');

const properties = {};
const titleName = findProperty(draftSchema, ['記事タイトル', 'タイトル', '名前', 'Name'], 'title');
if (!titleName) throw new Error('Article draft database has no title property');
properties[titleName] = makeProperty('title', article.title);
properties[siteProperty] = makeProperty('select', targetSite);

const mappings = [
  [['ステータス', 'Status'], ['status', 'select'], process.env.NOTION_REVIEW_STATUS || '要レビュー'],
  [['記事種別'], ['select'], articleType],
  [['生成日', '作成日'], ['date'], new Date().toISOString().slice(0, 10)],
  [['元素材', '素材'], ['rich_text'], article.source_title],
  [['元素材URL', '素材URL'], ['url'], article.source_url],
  [['狙うキーワード', 'キーワード'], ['multi_select', 'rich_text'], article.keywords],
  [['スラッグ', 'slug', 'Slug'], ['rich_text'], article.slug],
  [['判断ライブラリ', '参照判断'], ['rich_text'], article.judgment_titles.join('、')],
];
for (const [names, types, value] of mappings) {
  for (const type of types) {
    const name = findProperty(draftSchema, names, type);
    if (name) {
      const mappedValue = type === 'rich_text' && Array.isArray(value) ? value.join('、') : value;
      properties[name] = makeProperty(type, mappedValue);
      break;
    }
  }
}

const page = await createPage(draftId, properties, markdownToBlocks(article.markdown));
console.log(JSON.stringify({ created: true, site: targetSite, title: article.title, notion_url: page.url, source: article.source_title }, null, 2));
