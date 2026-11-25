import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 記事本文に書かれた「# 見出し」（H1）を取り除く。
// H1 は記事ページのテンプレートが frontmatter の title から出すので、本文側の H1 は重複になる。
// 本文に H1 がある記事とない記事が混在していた（ない記事はページに H1 が無かった）ための対処。
function removeBodyH1() {
  return (tree) => {
    tree.children = tree.children.filter((node) => !(node.type === 'heading' && node.depth === 1));
  };
}

export default defineConfig({
  site: 'https://keieikanri.ciza.co.jp',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  markdown: { remarkPlugins: [removeBodyH1] },
  integrations: [
    // /check/thanks は noindex のサンクスページなのでサイトマップに載せない（GSC の「noindex タグによって除外」警告の原因）
    sitemap({ filter: (page) => !page.includes('/api/') && !page.includes('/check/thanks') }),
  ],
});
